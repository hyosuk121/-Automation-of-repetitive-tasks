import {test} from 'node:test';import assert from 'node:assert/strict';import {summarizeRows,isPriorityCountry} from '../web/aviation-dashboard.js';
import {recentMonths} from '../web/aviation-recent.js';
const row={yearMonth:'202609',nationCode:'1',nationName:'일본',airlineIataCode:'AA',airportCode:'NRT',regularCode:'0',departuresOrArrivals:'D',paxCode:'Y',totalEff:'100',totalTrf:'20'};
test('preview excludes every ambiguous row and never adds transfers or missing data',()=>{
 const result=summarizeRows([row,{...row,totalEff:'200'},{...row,airportCode:'KIX',totalEff:'50'},{...row,airportCode:'YCU',nationCode:'',nationName:''},{...row,yearMonth:'202610'}],'202609');
 assert.equal(result.total,4);assert.equal(result.excluded,3);assert.equal(result.countries.find(c=>c.name==='일본').paid,50);assert.equal(result.countries.find(c=>c.name==='국가 미분류').included,0);
 assert.equal(result.countries.find(c=>c.name==='국가 미분류').code,'__missing__');
 assert.deepEqual(result.reasons,[['동일 조건 복수 행',2],['국가 누락',1]]);
});
test('recent months are unique and priority countries are recognized',()=>{
 assert.deepEqual(recentMonths([{months:['202608','202609']},{months:['202609','202607','invalid']}]),['202609','202608','202607']);
 assert.equal(isPriorityCountry('일본'),true);
 assert.equal(isPriorityCountry('베트남'),true);
 assert.equal(isPriorityCountry('영국'),false);
});
test('country code groups labels together and unsafe totals stay out of the preview',()=>{
 const result=summarizeRows([{...row,airportCode:'NRT',totalEff:'100'}, {...row,airportCode:'KIX',nationName:'일본 ',totalEff:'200'}, {...row,airportCode:'HND',totalEff:String(Number.MAX_SAFE_INTEGER)}],'202609');
 assert.equal(result.countries.length,1);
 assert.equal(result.countries[0].paid,300);
 assert.equal(result.excluded,1);
 assert.equal(result.rows[2].reason,'합계 범위 초과');
});
