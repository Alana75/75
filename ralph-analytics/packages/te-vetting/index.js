#!/usr/bin/env node
'use strict';
const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3120;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', '@ralph/te-vetting');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// ── In-memory store (replace with MySQL in production) ──────────────────
const members = new Map();
const auditLog = [];

function generateId() { return 'te_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
function log(action, data) { auditLog.push({ ts: new Date().toISOString(), action, data }); }

// ── Risk Scoring Engine ─────────────────────────────────────────────────
function calcRiskScore(member) {
  let score = 0;
  const { geography, certStatus, transitionProgress, docCompleteness, supplyChainDepth, standardsGap } = member;

  // Geography risk (0-25)
  const geoRisk = { low: 5, medium: 12, high: 20, critical: 25 };
  score += geoRisk[geography] || 12;

  // Cert status (0-25)
  const certRisk = { certified: 0, transitioning: 12, 'non-compliant': 25, unknown: 20 };
  score += certRisk[certStatus] || 20;

  // Transition progress (0-20)
  const tp = Number(transitionProgress) || 0;
  score += Math.round((1 - tp/100) * 20);

  // Documentation completeness (0-20)
  const dc = Number(docCompleteness) || 0;
  score += Math.round((1 - dc/100) * 20);

  // Supply chain depth (0-10)
  const scdRisk = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10 };
  score += scdRisk[supplyChainDepth] || 5;

  return Math.min(100, score);
}

function getComplianceStatus(score, member) {
  if (member.certStatus === 'certified' && score < 20) return 'Compliant';
  if (score >= 65 || member.certStatus === 'non-compliant') return 'Non-Compliant';
  return 'In Transition';
}

function identifyGaps(member) {
  const gaps = [];
  if (!member.organicCert)        gaps.push('Organic fibre certification missing');
  if (!member.recycledCert)       gaps.push('Recycled content verification missing');
  if (!member.traceabilitySystem) gaps.push('Supply chain traceability system not documented');
  if (!member.auditReport)        gaps.push('Third-party audit report not provided');
  if ((member.transitionProgress||0) < 50) gaps.push('Transition milestone completion below 50%');
  if (!member.transitionPlan)     gaps.push('Formal transition plan not submitted');
  if (!member.grievanceMechanism) gaps.push('Worker grievance mechanism not evidenced');
  if (!member.chemicalPolicy)     gaps.push('Chemical management policy absent (ZDHC/Bluesign)');
  // POPIA/GDPR overlay
  if (!member.dataPrivacyPolicy)  gaps.push('Data privacy policy required (POPIA/GDPR compliance)');
  return gaps;
}

function recommendedActions(gaps, score) {
  const actions = gaps.map(g => ({ priority: score > 65 ? 'High' : 'Medium', action: g.replace('missing','required').replace('not provided','must be submitted').replace('absent','must be established') }));
  if (score > 75) actions.unshift({ priority: 'Critical', action: 'Immediate escalation to human reviewer — high risk score' });
  return actions;
}

// ── API Routes ──────────────────────────────────────────────────────────

// Health
app.get('/health', (req, res) => res.json({ status:'ok', service:'@ralph/te-vetting', port: PORT, members: members.size }));

// Intake — create/update member
app.post('/api/members', (req, res) => {
  const id = req.body.id || generateId();
  const member = { id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...req.body };
  members.set(id, member);
  log('member.created', { id, company: member.companyName });
  res.json({ success: true, id, message: 'Member registered' });
});

// Full assessment — score, status, gaps, actions
app.get('/api/members/:id/assess', (req, res) => {
  const member = members.get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const riskScore        = calcRiskScore(member);
  const complianceStatus = getComplianceStatus(riskScore, member);
  const gaps             = identifyGaps(member);
  const actions          = recommendedActions(gaps, riskScore);
  const confidence       = member.docCompleteness >= 80 ? 'High' : member.docCompleteness >= 50 ? 'Medium' : 'Low';
  const escalated        = riskScore >= 70 || confidence === 'Low';

  const report = {
    memberId:         member.id,
    companyName:      member.companyName,
    assessedAt:       new Date().toISOString(),
    complianceStatus,
    riskScore,
    confidence,
    escalationStatus: escalated ? 'Escalated — Requires Human Review' : 'No escalation required',
    gaps,
    recommendedActions: actions,
    standardsChecked: ['TE Organic', 'TE Recycled', 'TE Preferred Fibres', 'ZDHC MRSL', 'Bluesign', 'POPIA', 'GDPR'],
    regulatoryOverlay: { popia: true, gdpr: true, euSupplyChainDue: member.geography === 'EU' }
  };

  log('assessment.completed', { id: member.id, score: riskScore, status: complianceStatus });
  members.set(member.id, { ...member, lastAssessment: report });
  res.json({ success: true, data: report });
});

// List all members with status
app.get('/api/members', (req, res) => {
  const list = Array.from(members.values()).map(m => ({
    id: m.id, companyName: m.companyName, certStatus: m.certStatus,
    geography: m.geography, riskScore: m.lastAssessment?.riskScore || null,
    complianceStatus: m.lastAssessment?.complianceStatus || 'Pending',
    lastAssessed: m.lastAssessment?.assessedAt || null
  }));
  res.json({ success: true, data: list, total: list.length });
});

// Portfolio dashboard
app.get('/api/portfolio', (req, res) => {
  const all = Array.from(members.values());
  const assessed = all.filter(m => m.lastAssessment);
  const compliant     = assessed.filter(m => m.lastAssessment.complianceStatus === 'Compliant').length;
  const inTransition  = assessed.filter(m => m.lastAssessment.complianceStatus === 'In Transition').length;
  const nonCompliant  = assessed.filter(m => m.lastAssessment.complianceStatus === 'Non-Compliant').length;
  const avgScore      = assessed.length ? Math.round(assessed.reduce((s,m) => s + m.lastAssessment.riskScore, 0) / assessed.length) : 0;
  const highRisk      = assessed.filter(m => m.lastAssessment.riskScore >= 65);

  res.json({ success: true, data: {
    totalMembers: all.length, assessed: assessed.length,
    compliant, inTransition, nonCompliant,
    complianceRate: assessed.length ? Math.round(compliant/assessed.length*100) : 0,
    avgRiskScore: avgScore, highRiskCount: highRisk.length,
    highRiskMembers: highRisk.map(m => ({ id: m.id, company: m.companyName, score: m.lastAssessment.riskScore }))
  }});
});

// Monitoring — flag overdue transitions
app.get('/api/monitoring/alerts', (req, res) => {
  const alerts = [];
  members.forEach(m => {
    if (m.certExpiry && new Date(m.certExpiry) < new Date(Date.now() + 30*24*3600*1000))
      alerts.push({ id: m.id, company: m.companyName, alert: 'Certification expiring within 30 days', severity: 'High' });
    if ((m.transitionProgress||0) < 25 && m.certStatus === 'transitioning')
      alerts.push({ id: m.id, company: m.companyName, alert: 'Transition severely behind schedule', severity: 'Critical' });
    if (m.lastAssessment && m.lastAssessment.riskScore >= 70)
      alerts.push({ id: m.id, company: m.companyName, alert: 'High risk score — pending human review', severity: 'High' });
  });
  res.json({ success: true, alerts, count: alerts.length });
});

// Audit log
app.get('/api/audit-log', (req, res) => res.json({ success: true, log: auditLog.slice(-100) }));

app.listen(PORT, () => console.log('[TE-Vetting] Running on port ' + PORT));
