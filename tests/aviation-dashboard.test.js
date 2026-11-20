import {test} from 'node:test';import assert from 'node:assert/strict';import {summarizeRows} from '../web/aviation-dashboard.js';
const row={yearMonth:'202609',nationCode:'1',nationName:'일본',airlineIataCode:'AA',airportCode:'NRT',regularCode:'0',departuresOrArrivals:'D',paxCode:'Y',totalEff:'100',totalTrf:'20'};
test('preview excludes every ambiguous row and never adds transfers or missing data',()=>{
 const result=summarizeRows([row,{...row,totalEff:'200'},{...row,airportCode:'KIX',totalEff:'50'},{...row,airportCode:'YCU',nationCode:'',nationName:''},{...row,yearMonth:'202610'}],'202609');
 assert.equal(result.total,4);assert.equal(result.excluded,3);assert.equal(result.countries.find(c=>c.name==='일본').paid,50);assert.equal(result.countries.find(c=>c.name==='국가 미분류').included,0);
});
