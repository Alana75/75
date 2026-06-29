#!/usr/bin/env node
/**
 * ralph CLI — package orchestration commands
 * Usage: ralph packages:sync
 *        ralph packages:list
 *        ralph clients:list
 *        ralph clients:create --name "Acme Corp" --slug acme
 *        ralph assign --client <id> --package <name>
 */
import { Command } from 'commander';
import { packageLoader }    from '../loader/PackageLoader.js';
import { packageRegistry }  from '../registry/PackageRegistry.js';
import { clientRegistry }   from '../clients/ClientRegistry.js';
import { assignmentManager } from '../assignments/AssignmentManager.js';

const program = new Command();

program
  .name('ralph')
  .description('Ralph Platform Orchestrator CLI')
  .version('1.0.0');

// ── packages:sync ─────────────────────────────────────────────
program
  .command('packages:sync')
  .description('Scan monorepo and register all Ralph packages')
  .action(() => {
    console.log('🔍 Scanning for Ralph packages...\n');
    const result = packageLoader.sync();
    console.log(`✅ Sync complete:`);
    console.log(`   Discovered: ${result.discovered}`);
    console.log(`   Registered: ${result.registered}`);
    console.log(`   Updated:    ${result.updated}`);
    if (result.errors.length > 0) {
      console.log(`   Errors (${result.errors.length}):`);
      result.errors.forEach(e => console.log(`     ❌ ${e.path}: ${e.error}`));
    }
  });

// ── packages:list ─────────────────────────────────────────────
program
  .command('packages:list')
  .description('List all registered packages')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const packages = packageRegistry.list();
    if (opts.json) { console.log(JSON.stringify(packages, null, 2)); return; }
    if (!packages.length) { console.log('No packages registered.'); return; }
    console.log(`\n${'NAME'.padEnd(35)} ${'ROUTE'.padEnd(20)} ${'TYPE'.padEnd(12)} ${'STATUS'.padEnd(10)} VERSION`);
    console.log('─'.repeat(90));
    packages.forEach(p => {
      const status = p.status === 'active' ? '✅ active' : '⏸  inactive';
      console.log(`${p.name.padEnd(35)} ${p.route.padEnd(20)} ${p.type.padEnd(12)} ${status.padEnd(10)} ${p.version}`);
    });
    console.log(`\nTotal: ${packages.length}`);
  });

// ── clients:list ──────────────────────────────────────────────
program
  .command('clients:list')
  .description('List all registered clients')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const clients = clientRegistry.list();
    if (opts.json) { console.log(JSON.stringify(clients, null, 2)); return; }
    if (!clients.length) { console.log('No clients registered.'); return; }
    console.log(`\n${'ID'.padEnd(20)} ${'NAME'.padEnd(25)} ${'SLUG'.padEnd(20)} ${'TIER'.padEnd(14)} ACTIVE`);
    console.log('─'.repeat(85));
    clients.forEach(c => {
      console.log(`${c.id.padEnd(20)} ${c.name.padEnd(25)} ${c.slug.padEnd(20)} ${c.tier.padEnd(14)} ${c.active ? '✅' : '❌'}`);
    });
    console.log(`\nTotal: ${clients.length}`);
  });

// ── clients:create ────────────────────────────────────────────
program
  .command('clients:create')
  .description('Register a new client')
  .requiredOption('--name <name>', 'Client name')
  .requiredOption('--slug <slug>', 'URL slug (lowercase, hyphens only)')
  .option('--email <email>', 'Contact email')
  .option('--domain <domain>', 'Custom domain')
  .option('--tier <tier>', 'Tier: free|professional|enterprise', 'free')
  .action((opts) => {
    try {
      const client = clientRegistry.create(opts);
      console.log(`✅ Client created: ${client.name} (${client.id})`);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── assign ────────────────────────────────────────────────────
program
  .command('assign')
  .description('Assign a package to a client')
  .requiredOption('--client <clientId>', 'Client ID')
  .requiredOption('--package <packageName>', 'Package name')
  .option('--by <by>', 'Assigned by (user name/email)')
  .action((opts) => {
    try {
      const assignment = assignmentManager.assign({
        clientId:    opts.client,
        packageName: opts.package,
        assignedBy:  opts.by,
      });
      console.log(`✅ Assigned '${assignment.packageName}' to client '${assignment.clientId}'`);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── status ────────────────────────────────────────────────────
program
  .command('status')
  .description('Show orchestrator status')
  .action(() => {
    console.log('\n📦 @ralph/package-orchestrator');
    console.log('─'.repeat(40));
    console.log(`  Packages:    ${packageRegistry.count()}`);
    console.log(`  Clients:     ${clientRegistry.count()}`);
    console.log(`  Assignments: ${assignmentManager.count()}`);
  });

program.parse(process.argv);
