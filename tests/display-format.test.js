import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ratingLabel} from '../web/chart-utils.js';
import {rankingPeriod} from '../lib/ranking-period.js';
import {ratingChart} from '../web/rating-chart.js';
test('ratings round to two decimals without turning missing values into zero',()=>{
 assert.equal(ratingLabel(4.005),'4.01');
 assert.equal(ratingLabel(4.81968),'4.82');assert.equal(ratingLabel(4.7),'4.70');assert.equal(ratingLabel(0),'0.00');assert.equal(ratingLabel(null),'—');
 const html=ratingChart([{collected_at:'2026-07-09T05:00:00Z',rating:null},{collected_at:'2026-10-21T01:00:00Z',rating:4.81968}],'로밍도깨비');
 assert.equal((html.match(/data-chart-point/g)||[]).length,1);assert.ok(html.includes('4.82점'));assert.equal(html.includes('2026-07-09'),false);
});
test('custom rank ranges validate calendar dates, ordering and maximum span',()=>{
 assert.equal(rankingPeriod(new URLSearchParams('from=2026-07-09&to=2026-10-21')).from,'2026-07-09');
 for(const q of ['from=2026-02-30&to=2026-03-01','from=2026-10-21&to=2026-10-20','from=2020-01-01&to=2026-10-21','from=2026-01-01','from=2099-01-01&to=2099-01-02'])assert.throws(()=>rankingPeriod(new URLSearchParams(q)));
});
