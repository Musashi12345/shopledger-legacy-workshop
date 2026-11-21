'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pricing = require('../lib/pricing');
const invoice = require('../lib/invoice');
const reports = require('../lib/reports');

function item(overrides) {
  return Object.assign({
    id: 1,
    sku: 'TEST-001',
    name: 'Test product',
    hsn: '1006',
    price: 100,
    qty: 1
  }, overrides || {});
}

function savedOrder(overrides) {
  const items = (overrides && overrides.items) || [item()];
  const ledger = pricing.computeTotals(items, (overrides && overrides.coupon) || '');
  return Object.assign({
    id: 1,
    date: '21/11/2026',
    customer: 'In-memory customer',
    paymentMode: 'cash',
    status: 'completed',
    items,
    coupon: '',
    subtotal: ledger.subtotal,
    discount: ledger.discount,
    tax: ledger.tax,
    total: ledger.total
  }, overrides || {}, {
    items,
    subtotal: (overrides && overrides.subtotal) != null ? overrides.subtotal : ledger.subtotal,
    discount: (overrides && overrides.discount) != null ? overrides.discount : ledger.discount,
    tax: (overrides && overrides.tax) != null ? overrides.tax : ledger.tax,
    total: (overrides && overrides.total) != null ? overrides.total : ledger.total
  });
}

test('CURRENT BEHAVIOUR: invoice tax breakdown and total match the billed HSN-rated order', function () {
  const lines = [item({ price: 100 })];
  const billed = pricing.computeTotals(lines, '');
  const printed = invoice.computeInvoiceFigures(savedOrder({ items: lines }));

  assert.equal(printed.tax, billed.tax);
  assert.equal(printed.cgst, billed.cgst);
  assert.equal(printed.sgst, billed.sgst);
  assert.equal(printed.total, billed.total);
  assert.equal(printed.rows[0].gstPercent, billed.lines[0].gstPercent);
  assert.equal(printed.rows[0].lineTax, billed.lines[0].tax);
});

test('CURRENT BEHAVIOUR: invoice uses the HSN GST rate used for billing', function () {
  const lines = [item({ price: 100 })];
  const billed = pricing.computeTotals(lines, '');
  const printed = invoice.computeInvoiceFigures(savedOrder({ items: lines }));

  assert.equal(billed.tax, 5);
  assert.equal(billed.total, 105);
  assert.equal(printed.rows[0].gstPercent, 5);
  assert.equal(printed.tax, 5);
  assert.equal(printed.total, 105);
});

test('CURRENT BEHAVIOUR: an unmapped HSN uses the default GST rate in both calculations', function () {
  const lines = [item({ hsn: '9999', price: 100 })];
  const billed = pricing.computeTotals(lines, '');
  const printed = invoice.computeInvoiceFigures(savedOrder({ items: lines }));

  assert.equal(billed.tax, 18);
  assert.equal(printed.tax, 18);
  assert.equal(billed.total, printed.total);
});

test('CURRENT BEHAVIOUR: decimal gstRate is interpreted consistently by pricing and invoice', function () {
  const lines = [item({ gstRate: 0.05, price: 100 })];
  const billed = pricing.computeTotals(lines, '');
  const printed = invoice.computeInvoiceFigures(savedOrder({ items: lines }));

  assert.equal(billed.lines[0].gstPercent, 5);
  assert.equal(billed.tax, 5);
  assert.equal(printed.rows[0].gstPercent, 5);
  assert.equal(printed.tax, 5);
});

test('CURRENT BEHAVIOUR: invoice uses the billed percent coupon discount and post-discount GST', function () {
  const lines = [item({ price: 1000 })];
  const billed = pricing.computeTotals(lines, 'SAVE10');
  const printed = invoice.computeInvoiceFigures(savedOrder({ items: lines, coupon: 'SAVE10' }));

  assert.equal(billed.discount, 100);
  assert.equal(billed.tax, 45);
  assert.equal(billed.total, 945);
  assert.equal(printed.discount, 100);
  assert.equal(printed.tax, 45);
  assert.equal(printed.total, 945);
});

test('CURRENT BEHAVIOUR: invoice applies the configured percentage coupon cap', function () {
  const lines = [item({ price: 4000 })];
  const billed = pricing.computeTotals(lines, 'SAVE10');
  const printed = invoice.computeInvoiceFigures(savedOrder({ items: lines, coupon: 'SAVE10' }));

  assert.equal(billed.discount, 150);
  assert.equal(printed.discount, 150);
  assert.equal(billed.total, 4042.5);
  assert.equal(printed.total, 4042.5);
});

test('CURRENT BEHAVIOUR: invoice does not apply an inactive coupon', function () {
  const lines = [item({ price: 1000 })];
  const billed = pricing.computeTotals(lines, 'DIWALI20');
  const printed = invoice.computeInvoiceFigures(savedOrder({ items: lines, coupon: 'DIWALI20' }));

  assert.equal(billed.discount, 0);
  assert.equal(billed.total, 1050);
  assert.equal(printed.discount, 0);
  assert.equal(printed.total, 1050);
});

test('CURRENT BEHAVIOUR: GST reconciliation matches active orders and skips cancelled orders', function () {
  const active = savedOrder({ id: 10, items: [item({ price: 100 })] });
  const cancelled = savedOrder({ id: 11, status: 'cancelled', items: [item({ price: 100 })] });
  const result = reports.getGstReconciliation({ orders: [active, cancelled] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.deepEqual(result.rows.map((row) => row.orderId), [10]);
  assert.equal(result.rows[0].ledgerTax, 5);
  assert.equal(result.rows[0].invoiceTax, 5);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});
