#!/usr/bin/env node
'use strict';
const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3120;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// ── In-memory store (MySQL migration follows same pattern as main service) ──
const members = new Map();
const auditLog = [];
let idCounter = 1;

function generateId() { return 'TE-' + String(idCounter++).padStart(5,'0'); }
function logAction(action, data) { auditLog.push({ ts: new Date().toISOString(), action, data }); }

// ════════════════════════════════════════════════════════════════════════
// MATERIALS MATTER STANDARD — Supply Chain Tier Definitions
// Tier 4: Raw material producers (farms, recyclers)
// Tier 3: Primary processors (spinning, scouring, combing)
// Tier 2: Material processing (weaving, knitting, dyeing)
// Tier 1: Product assembly (cut & sew, garment manufacturing)
// Tier 0: Brands / Retailers
// ════════════════════════════════════════════════════════════════════════

// Standards being superseded → Materials Matter Standard (MMS)
// GRS-101 Global Recycled Standard     → MMS effective Dec 31 2026, mandatory Dec 31 2027
// RCS-101 Recycled Claim Standard      → MMS effective Dec 31 2026, mandatory Dec 31 2027
// RAF-101a Responsible Wool Standard   → MMS effective Dec 31 2026, mandatory Dec 31 2027
// RAF-101b Responsible Mohair Standard → MMS effective Dec 31 2026, mandatory Dec 31 2027
// RAF-101c Responsible Alpaca Standard → MMS effective Dec 31 2026, mandatory Dec 31 2027
// OCS (Organic Content Standard)       → Remains OUTSIDE MMS — parallel track
// RDS (Responsible Down Standard)      → Remains OUTSIDE MMS — parallel track

// ── KEY DATES ──────────────────────────────────────────────────────────
const DATES = {
  mms_published:     '2025-12-12',
  mms_effective:     '2026-12-31',   // audits MAY be conducted to MMS
  mms_mandatory:     '2027-12-31',   // ALL audits MUST be to MMS
  claims_effective:  '2026-12-31',   // MMS claims label policy effective
  claims_mandatory:  '2029-06-30',   // all claims MUST use MMS labeling
  legacy_withdrawn:  '2029-03-31',   // all GRS/RCS/RAF scope certs withdrawn
  rmdf_mandatory:    '2026-12-31',   // Reclaimed Material Declaration Form mandatory
  ab_reapply_by:     '2026-06-01',   // Accreditation bodies must reapply
};

// ── MATERIAL SCOPE ─────────────────────────────────────────────────────
const MMS_ELIGIBLE_MATERIALS = {
  animal: ['wool','mohair','alpaca','hide_rawhide','wool_byproduct','mohair_byproduct','alpaca_byproduct'],
  recycled: ['recycled_plant_fiber','recycled_animal_fiber','recycled_down','recycled_synthetic',
             'recycled_mmcf','recycled_cotton','recycled_polyester','recycled_nylon','recycled_other'],
  outOfScope: ['ocs_organic_cotton','ocs_other_organic','rds_down'],  // OCS + RDS remain outside MMS
};

// ── MINIMUM LABELING THRESHOLDS (POL-301 / GUI-304/601/602) ──────────
function getLabelingThreshold(material) {
  // Exception: recycled cotton & recycled MMCF = 20% (single material only)
  if (['recycled_cotton','recycled_mmcf'].includes(material)) return 20;
  return 30; // Standard threshold for all other materials
}

// ── TIER CERTIFICATION RULES ───────────────────────────────────────────
function getTierCertRequirements(tier) {
  const rules = {
    4: { standard: 'MMS (TE-MM-STN-101)', certValidity: '3 years', trackingStandard: 'CCS optional',
         auditFreq: 'Annual surveillance + 3yr recert', rmdfRequired: true,
         zdhcRequired: true, scopeNote: 'Farms, recyclers, primary processors of animal fibers' },
    3: { standard: 'CCS (Content Claim Standard)', certValidity: '1 year', trackingStandard: 'CCS required',
         auditFreq: 'Annual', rmdfRequired: false,
         scopeNote: 'Spinning mills, scouring, combing, primary processing downstream of Tier 4' },
    2: { standard: 'CCS (Content Claim Standard)', certValidity: '1 year', trackingStandard: 'CCS required',
         auditFreq: 'Annual', rmdfRequired: false,
         scopeNote: 'Weaving, knitting, dyeing, finishing' },
    1: { standard: 'CCS (Content Claim Standard)', certValidity: '1 year', trackingStandard: 'CCS required',
         auditFreq: 'Annual', rmdfRequired: false,
         scopeNote: 'Garment assembly, cut & sew' },
    0: { standard: 'Claims approval via TE + license agreement', certValidity: 'N/A', trackingStandard: 'N/A',
         auditFreq: 'Claim submission per product', rmdfRequired: false,
         scopeNote: 'Brands / Retailers — outside chain of custody, claims require TE approval + license' },
  };
  return rules[tier] || rules[1];
}

// ── MMS PRINCIPLES ASSESSMENT (7 Principles) ──────────────────────────
// Based on TE-MM-STN-101 (Wool, Mohair, Alpaca, Processing excerpts)
function assessMMSPrinciples(member) {
  const results = {};

  // P1: Organizational Management
  results.p1_org_mgmt = {
    label: 'Principle 1: Organizational Management',
    criteria: [
      { ref:'1.1', name:'Management system documented', met: !!member.mgmtSystemDoc, required: true },
      { ref:'1.2', name:'Roles & responsibilities assigned', met: !!member.rolesAssigned, required: true },
      { ref:'1.1', name:'TE-ID registered on Trackit platform', met: !!member.teId, required: true },
    ]
  };

  // P2: Human Rights & Livelihoods
  results.p2_human_rights = {
    label: 'Principle 2: Human Rights & Livelihoods',
    criteria: [
      { ref:'2.1', name:'Human rights due diligence process', met: !!member.humanRightsDueDiligence, required: true },
      { ref:'2.2', name:'Responsible working practices policy', met: !!member.workingPracticesPolicy, required: true },
      { ref:'2.3', name:'Health & safety management system', met: !!member.healthSafetySystem, required: true },
      { ref:'2.4', name:'Fair pay documented & verified', met: !!member.fairPayEvidence, required: true },
      { ref:'2.5', name:'Child labor & forced labor controls', met: !!member.childForcedLaborControls, required: true },
      { ref:'2.6', name:'Livelihoods program (Tier 4 farms)', met: member.tier === 4 ? !!member.livelihoodsProgram : true, required: member.tier === 4 },
    ]
  };

  // P3: Land Use (Tier 4 farms only — animal fiber producers)
  results.p3_land_use = {
    label: 'Principle 3: Land Use',
    applicableTo: [4],
    criteria: member.tier === 4 ? [
      { ref:'3.1', name:'Land management plan', met: !!member.landMgmtPlan, required: true },
      { ref:'3.2', name:'Soil health monitoring', met: !!member.soilHealthMonitoring, required: true },
      { ref:'3.3', name:'Soil nutrient management', met: !!member.soilNutrientMgmt, required: false },
      { ref:'3.4', name:'Pest management plan (no prohibited substances)', met: !!member.pestMgmtPlan, required: true },
      { ref:'3.5', name:'Water management plan', met: !!member.waterMgmtPlan, required: true },
      { ref:'3.6', name:'Biodiversity management plan', met: !!member.biodiversityPlan, required: false },
    ] : [{ ref:'N/A', name:'Not applicable to this tier', met: true, required: false }]
  };

  // P4: Animal Welfare (Tier 4 farms + processing facilities with slaughter)
  results.p4_animal_welfare = {
    label: 'Principle 4: Animal Welfare',
    applicableTo: [4],
    criteria: (member.tier === 4 || member.hasSlaughter) ? [
      { ref:'4.1', name:'Animal health & welfare plan', met: !!member.animalWelfarePlan, required: true },
      { ref:'4.2', name:'Animal nutrition program', met: !!member.animalNutritionProgram, required: true },
      { ref:'4.3', name:'Adequate living environment', met: !!member.adequateLivingEnv, required: true },
      { ref:'4.4', name:'Husbandry procedures compliant (no mulesing for wool)', met: !!member.humanePractices, required: true },
      { ref:'4.5', name:'Shearing conducted humanely', met: member.materialType === 'wool' ? !!member.humaneSheering : true, required: member.materialType === 'wool' },
      { ref:'4.8', name:'Transport & handling standards met', met: !!member.transportStandards, required: true },
      { ref:'4.10', name:'Euthanasia / slaughter protocols (if applicable)', met: member.hasSlaughter ? !!member.slaughterProtocols : true, required: member.hasSlaughter },
    ] : [{ ref:'N/A', name:'Not applicable to this tier', met: true, required: false }]
  };

  // P5: Processing Facility (Tier 3–1 processors and recyclers)
  results.p5_processing = {
    label: 'Principle 5: Processing Facility',
    applicableTo: [1,2,3,4],
    criteria: (member.tier <= 3 || (member.tier === 4 && member.isPrimaryProcessor)) ? [
      { ref:'5.1', name:'Environmental management system (ISO 14001 or equiv)', met: !!member.envMgmtSystem, required: true },
      { ref:'5.2', name:'Chemical management — ZDHC MRSL conformance', met: !!member.zdhcConformance, required: true },
      { ref:'5.2', name:'ZDHC fiber-specific guidelines implemented', met: !!member.zdhcFiberGuidelines, required: true },
      { ref:'5.2', name:'Reclaimed Material Declaration Form (RMDF) — if recycler', met: member.isRecycler ? !!member.rmdfCompleted : true, required: member.isRecycler },
      { ref:'5.3', name:'Waste management program', met: !!member.wasteMgmtProgram, required: true },
      { ref:'5.4', name:'Wastewater treatment & discharge limits met', met: !!member.wastewaterTreatment, required: true },
      { ref:'5.5', name:'Air emissions monitored & controlled', met: !!member.airEmissionsMonitoring, required: true },
      { ref:'5.6', name:'Energy use tracked & reduction targets set', met: !!member.energyTracking, required: false },
    ] : [{ ref:'N/A', name:'Not applicable to this tier', met: true, required: false }]
  };

  // P6: Chain of Custody
  results.p6_chain_of_custody = {
    label: 'Principle 6: Chain of Custody',
    criteria: [
      { ref:'6.1', name:'Material handling & segregation controls', met: !!member.materialSegregation, required: true },
      { ref:'6.2', name:'Volume reconciliation system', met: !!member.volumeReconciliation, required: true },
      { ref:'6.3', name:'Transaction certificates issued/received correctly', met: !!member.transactionCerts, required: true },
      { ref:'6.4', name:'Logo/claims use approved per MMS Claims Policy', met: !!member.claimsApproved, required: true },
      { ref:'6.4', name:'Trademark license agreement signed with TE', met: !!member.trademarkLicenseSigned, required: true },
      { ref:'6.4', name:'TE-ID included on all B2B claims', met: !!member.teId, required: true },
    ]
  };

  // P7: Group Certification (if applicable)
  results.p7_group_cert = {
    label: 'Principle 7: Group Certification',
    criteria: member.isGroupCert ? [
      { ref:'7.1', name:'Group configuration documented', met: !!member.groupConfig, required: true },
      { ref:'7.2', name:'Group management system in place', met: !!member.groupMgmtSystem, required: true },
      { ref:'7.3', name:'Group member requirements communicated', met: !!member.groupMemberReqs, required: true },
      { ref:'7.4', name:'Internal inspection programme (60% to MMS if Tier 4)', met: !!member.internalInspections, required: true },
    ] : [{ ref:'N/A', name:'Group certification not applicable', met: true, required: false }]
  };

  return results;
}

// ── TRANSITION STATUS ASSESSMENT (POL-102) ────────────────────────────
function assessTransitionStatus(member) {
  const today = new Date();
  const MMS_EFFECTIVE = new Date(DATES.mms_effective);
  const MMS_MANDATORY = new Date(DATES.mms_mandatory);
  const LEGACY_WITHDRAWN = new Date(DATES.legacy_withdrawn);

  const checks = [];
  const legacyStandards = member.legacyCertifications || [];

  // Check: legacy standards being used post-mandatory date
  if (today >= MMS_MANDATORY) {
    const stillOnLegacy = legacyStandards.filter(s => ['GRS','RCS','RWS','RMS','RAS'].includes(s));
    if (stillOnLegacy.length > 0) {
      checks.push({ severity: 'Critical', issue: `Still certified to legacy standard(s): ${stillOnLegacy.join(', ')} — all audits must now be to MMS (mandatory since Dec 31 2027)` });
    }
  }

  // Check: Tier 4 with GRS/RAF — cannot hold both MMS + legacy simultaneously
  if (member.tier === 4 && member.mmsCertified && legacyStandards.some(s => ['GRS','RWS','RMS','RAS'].includes(s))) {
    checks.push({ severity: 'High', issue: 'Tier 4: Cannot hold MMS scope cert AND GRS/RAF scope cert simultaneously (POL-102 §1.2.4). Legacy scope must be removed.' });
  }

  // Check: RCS materials cannot be used as inputs into MMS products
  if (member.usesRcsInputs && member.mmsCertified) {
    checks.push({ severity: 'Critical', issue: 'RCS certified materials are NOT eligible as inputs into MMS certified products (POL-102 §1.2.14 / §1.4.7). Immediate segregation required.' });
  }

  // Check: RMDF mandatory for recyclers from Dec 31 2026
  if (member.isRecycler && !member.rmdfCompleted) {
    checks.push({ severity: today >= new Date(DATES.rmdf_mandatory) ? 'Critical' : 'High',
      issue: 'Reclaimed Material Declaration Form (RMDF / TE-MM-TEM-105) is mandatory for recyclers from Dec 31 2026 (POL-102 §1.2.6 / §1.2.13)' });
  }

  // Check: Trademark license agreement required before any MMS claims
  if (!member.trademarkLicenseSigned && member.mmsCertified) {
    checks.push({ severity: 'Critical', issue: 'Trademark license agreement with Textile Exchange must be signed BEFORE any MMS certification mark or label use (POL-301 §1.1.1)' });
  }

  // Check: Tiers 1–3 with GRS+CCS → must transition to CCS only by Mar 31 2029
  if ([1,2,3].includes(member.tier) && legacyStandards.includes('GRS') && today >= LEGACY_WITHDRAWN) {
    checks.push({ severity: 'Critical', issue: 'Tiers 1–3 GRS certified organizations must have transitioned to CCS only by March 31 2029. All remaining GRS scope certs are now withdrawn.' });
  }

  // Check: Labeling threshold
  if (member.claimedContentPct !== undefined) {
    const threshold = getLabelingThreshold(member.primaryMaterial);
    if (member.claimedContentPct < threshold) {
      checks.push({ severity: 'High', issue: `Product claimed content (${member.claimedContentPct}%) is below the minimum labeling threshold (${threshold}%) for ${member.primaryMaterial} (POL-301 / GUI-304)` });
    }
  }

  // Check: Group cert — 60% internal inspections to MMS required
  if (member.isGroupCert && member.tier === 4 && (member.internalInspectionsPctToMMS || 0) < 60) {
    checks.push({ severity: 'High', issue: `Group cert: Only ${member.internalInspectionsPctToMMS || 0}% of internal inspections conducted to MMS standard. Minimum 60% required before external audit (POL-102 §1.3.2a)` });
  }

  // Determine overall transition status
  const critical = checks.filter(c => c.severity === 'Critical').length;
  const high     = checks.filter(c => c.severity === 'High').length;

  let status;
  if (!member.mmsCertified && today >= MMS_MANDATORY) status = 'Non-Compliant — Overdue';
  else if (critical > 0)  status = 'Non-Compliant';
  else if (high > 0)      status = 'In Transition — Issues';
  else if (member.mmsCertified) status = 'Compliant';
  else status = 'In Transition';

  return { status, checks, critical, high };
}

// ── RISK SCORING ENGINE ───────────────────────────────────────────────
function calcRiskScore(member, principles, transition) {
  let score = 0;

  // 1. Geography risk (0–20)
  const geoRisk = { low:4, medium:10, high:16, critical:20 };
  score += geoRisk[member.geographyRisk] || 10;

  // 2. MMS Principles conformance (0–30)
  let totalCriteria = 0, metCriteria = 0, missingRequired = 0;
  Object.values(principles).forEach(p => {
    p.criteria.forEach(c => {
      if (c.required) {
        totalCriteria++;
        if (c.met) metCriteria++;
        else missingRequired++;
      }
    });
  });
  const conformanceRate = totalCriteria > 0 ? metCriteria / totalCriteria : 0;
  score += Math.round((1 - conformanceRate) * 30);

  // 3. Transition compliance (0–25)
  score += Math.min(25, transition.critical * 10 + transition.high * 5);

  // 4. Documentation completeness (0–15)
  const dc = Number(member.docCompleteness) || 0;
  score += Math.round((1 - dc/100) * 15);

  // 5. Supply chain complexity / tier (0–10)
  const tierRisk = {0:8, 1:5, 2:4, 3:3, 4:2};
  score += tierRisk[member.tier] || 5;

  return Math.min(100, Math.round(score));
}

// ── GAPS — structured output for compliance report ─────────────────────
function buildGapReport(member, principles, transition) {
  const gaps = [];

  // From principles assessment
  Object.values(principles).forEach(p => {
    p.criteria.forEach(c => {
      if (!c.met && c.required) {
        gaps.push({ type: 'Standards Non-Conformance', standard: 'TE-MM-STN-101', ref: c.ref, description: c.name, severity: 'High' });
      }
    });
  });

  // From transition issues
  transition.checks.forEach(t => {
    gaps.push({ type: 'Transition Obligation', standard: 'TE-MM-POL-102', ref: 'POL-102', description: t.issue, severity: t.severity });
  });

  // Claims & labeling checks
  if (!member.claimsApproved && member.makesPublicClaims) {
    gaps.push({ type: 'Claims Compliance', standard: 'TE-MM-POL-301', ref: 'POL-301 §1.1.1', description: 'Public Materials Matter claims must be formally approved by Textile Exchange', severity: 'Critical' });
  }
  if (!member.teId) {
    gaps.push({ type: 'Claims Compliance', standard: 'TE-MM-POL-301', ref: 'POL-301', description: 'Textile Exchange ID (TE-ID) not registered — required on all B2B and consumer-facing claims', severity: 'High' });
  }

  // POPIA/GDPR overlay
  if (!member.dataPrivacyPolicy) {
    gaps.push({ type: 'Regulatory Overlay', standard: 'POPIA / GDPR', ref: 'Data Protection', description: 'Data privacy policy required — covers personal data of workers, suppliers, and buyers', severity: 'Medium' });
  }

  return gaps;
}

// ── API ROUTES ─────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({
  status: 'ok', service: '@ralph/te-vetting', port: PORT, members: members.size,
  standards: ['TE-MM-STN-101','TE-MM-POL-101','TE-MM-POL-102','TE-MM-POL-301','CCS-101'],
  keyDates: DATES
}));

// Create / update member
app.post('/api/members', (req, res) => {
  const id = req.body.id || generateId();
  const member = { id, registeredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...req.body };
  members.set(id, member);
  logAction('member.registered', { id, company: member.companyName, tier: member.tier });
  res.json({ success: true, id, message: 'Member registered in TE vetting system' });
});

// Full MMS-aligned assessment
app.get('/api/members/:id/assess', (req, res) => {
  const member = members.get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const principles        = assessMMSPrinciples(member);
  const transitionStatus  = assessTransitionStatus(member);
  const riskScore         = calcRiskScore(member, principles, transitionStatus);
  const gaps              = buildGapReport(member, principles, transitionStatus);
  const tierReqs          = getTierCertRequirements(member.tier || 1);
  const confidence        = (member.docCompleteness||0) >= 80 ? 'High' : (member.docCompleteness||0) >= 50 ? 'Medium' : 'Low';
  const escalate          = riskScore >= 65 || confidence === 'Low' || transitionStatus.critical > 0;

  const report = {
    memberId:             member.id,
    companyName:          member.companyName,
    assessedAt:           new Date().toISOString(),
    complianceStatus:     transitionStatus.status,
    riskScore,
    confidence,
    escalationStatus:     escalate ? 'ESCALATED — Human review required' : 'No escalation required',
    supplyChainTier:      member.tier || 'Unknown',
    tierCertRequirements: tierReqs,
    transitionAnalysis:   transitionStatus,
    principlesAssessment: principles,
    gaps,
    gapCount:             gaps.length,
    criticalGaps:         gaps.filter(g => g.severity === 'Critical').length,
    keyDates:             DATES,
    standardsChecked:     ['TE-MM-STN-101','TE-MM-POL-101','TE-MM-POL-102','TE-MM-POL-301','CCS-101','ZDHC MRSL','POPIA','GDPR'],
    regulatoryOverlay:    { popia: true, gdpr: true, euCSDDD: member.geographyRisk === 'eu_operations' },
    decisionRule:         escalate || gaps.filter(g=>g.severity==='Critical').length > 0
      ? 'NOT APPROVED — Evidence incomplete or critical gaps identified. Default: Needs Review.'
      : confidence === 'Low' ? 'NEEDS REVIEW — Low confidence score. Cannot approve without additional documentation.'
      : 'PENDING REVIEW — No critical issues. Recommend approval subject to human sign-off.'
  };

  logAction('assessment.completed', { id: member.id, score: riskScore, status: transitionStatus.status, gaps: gaps.length });
  members.set(member.id, { ...member, lastAssessment: report });
  res.json({ success: true, data: report });
});

// List members
app.get('/api/members', (req, res) => {
  const list = Array.from(members.values()).map(m => ({
    id: m.id, companyName: m.companyName, tier: m.tier,
    geographyRisk: m.geographyRisk, legacyCertifications: m.legacyCertifications || [],
    mmsCertified: m.mmsCertified,
    riskScore: m.lastAssessment?.riskScore ?? null,
    complianceStatus: m.lastAssessment?.complianceStatus || 'Pending Assessment',
    criticalGaps: m.lastAssessment?.criticalGaps ?? null,
    lastAssessed: m.lastAssessment?.assessedAt || null
  }));
  res.json({ success: true, data: list, total: list.length });
});

// Portfolio dashboard
app.get('/api/portfolio', (req, res) => {
  const all = Array.from(members.values());
  const assessed = all.filter(m => m.lastAssessment);
  const byStatus = (s) => assessed.filter(m => m.lastAssessment.complianceStatus.includes(s)).length;

  res.json({ success: true, data: {
    totalMembers: all.length, assessed: assessed.length,
    compliant:      assessed.filter(m => m.lastAssessment.complianceStatus === 'Compliant').length,
    inTransition:   assessed.filter(m => m.lastAssessment.complianceStatus.startsWith('In Transition')).length,
    nonCompliant:   assessed.filter(m => m.lastAssessment.complianceStatus.startsWith('Non-Compliant')).length,
    complianceRate: assessed.length ? Math.round(assessed.filter(m=>m.lastAssessment.complianceStatus==='Compliant').length/assessed.length*100) : 0,
    avgRiskScore:   assessed.length ? Math.round(assessed.reduce((s,m) => s+m.lastAssessment.riskScore,0)/assessed.length) : 0,
    highRiskMembers: assessed.filter(m => m.lastAssessment.riskScore >= 65)
      .map(m => ({ id:m.id, company:m.companyName, tier:m.tier, score:m.lastAssessment.riskScore, status:m.lastAssessment.complianceStatus })),
    escalated: assessed.filter(m => m.lastAssessment.escalationStatus.startsWith('ESCALATED')).length,
    keyDates: DATES
  }});
});

// Monitoring alerts
app.get('/api/monitoring/alerts', (req, res) => {
  const alerts = [];
  const today = new Date();
  members.forEach(m => {
    // Expiring certs
    if (m.certExpiry && new Date(m.certExpiry) < new Date(today.getTime() + 60*24*3600*1000))
      alerts.push({ id:m.id, company:m.companyName, tier:m.tier, alert:'Scope certificate expiring within 60 days — initiate recertification audit', severity:'High', ref:'POL-102 §1.1.1' });
    // Legacy withdrawal deadline approaching
    if ((m.legacyCertifications||[]).some(s=>['GRS','RCS','RWS','RMS','RAS'].includes(s)))
      alerts.push({ id:m.id, company:m.companyName, tier:m.tier, alert:'Legacy cert (GRS/RCS/RAF) still active — all must be withdrawn by March 31 2029', severity:'Medium', ref:'POL-102 §1.4.4' });
    // Not MMS certified and mandatory date approaching
    if (!m.mmsCertified && today >= new Date('2027-06-01'))
      alerts.push({ id:m.id, company:m.companyName, tier:m.tier, alert:'MMS certification not yet obtained — mandatory date Dec 31 2027 is approaching', severity:'High', ref:'POL-102 §B1.1.3' });
    // RMDF overdue for recyclers
    if (m.isRecycler && !m.rmdfCompleted && today >= new Date(DATES.rmdf_mandatory))
      alerts.push({ id:m.id, company:m.companyName, tier:m.tier, alert:'Reclaimed Material Declaration Form (RMDF) overdue — mandatory Dec 31 2026', severity:'Critical', ref:'POL-102 §1.2.6' });
    // Claims without license agreement
    if (m.makesPublicClaims && !m.trademarkLicenseSigned)
      alerts.push({ id:m.id, company:m.companyName, tier:m.tier, alert:'Trademark license agreement with TE not signed — MMS claims and labeling cannot be used', severity:'Critical', ref:'POL-301 §1.1.1' });
    // High risk score
    if (m.lastAssessment?.riskScore >= 65)
      alerts.push({ id:m.id, company:m.companyName, tier:m.tier, alert:'High risk score — escalated for human review', severity:'High', ref:'Risk Engine' });
  });
  res.json({ success: true, alerts, count: alerts.length });
});

// Standards reference data
app.get('/api/standards', (req, res) => {
  res.json({ success: true, data: {
    materialsMattersystem: {
      standard: 'TE-MM-STN-101 Materials Matter Standard',
      published: DATES.mms_published, effective: DATES.mms_effective, mandatory: DATES.mms_mandatory,
      supersedes: ['GRS-101','RCS-101','RAF-101a (RWS)','RAF-101b (RMS)','RAF-101c (RAS)'],
      remainsOutsideScope: ['OCS (Organic Content Standard)','RDS (Responsible Down Standard)'],
      eligibleMaterials: MMS_ELIGIBLE_MATERIALS,
      labelingThresholds: { standard: '30% minimum content', exception: '20% for recycled cotton & recycled MMCF (single material only)' },
      claimsPolicy: { effective: DATES.claims_effective, mandatory: DATES.claims_mandatory, requiresLicenseAgreement: true, requiresTeId: true }
    },
    supplyChainTiers: {
      4: 'Farms / Recyclers / Primary processors',
      3: 'Primary processing (spinning, scouring, combing)',
      2: 'Material processing (weaving, dyeing, knitting)',
      1: 'Product assembly (garment manufacturing)',
      0: 'Brands / Retailers'
    },
    certificationStandards: { tier4: 'MMS', tier1to3: 'CCS (Content Claim Standard)', tier0: 'Claims approval + license' },
    keyTransitionDates: DATES
  }});
});

// Audit log
app.get('/api/audit-log', (req, res) => res.json({ success: true, log: auditLog.slice(-200) }));

app.listen(PORT, () => {
  console.log(`[TE-Vetting] @ralph/te-vetting running on :${PORT}`);
  console.log(`[TE-Vetting] Aligned to: TE-MM-STN-101, TE-MM-POL-101, TE-MM-POL-102, TE-MM-POL-301, CCS-101`);
});
