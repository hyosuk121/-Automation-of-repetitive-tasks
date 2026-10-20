import { setTimeout } from 'node:timers/promises';
import { db } from '../lib/db.js';
import { scheduleDaily,workOnce } from '../lib/queue.js';
const database=db();
let stop=false,lastSchedule=0;
process.on('SIGINT',()=>{stop=true;});
process.on('SIGTERM',()=>{stop=true;});
console.log(JSON.stringify({event:'worker_started'}));
try {
  while(!stop) {
    try {
      if(Date.now()-lastSchedule>60000) {await scheduleDaily(database);lastSchedule=Date.now();}
      const worked=await workOnce(database);
      await setTimeout(worked?1500:5000);
    } catch(error) {
      console.error(JSON.stringify({event:'worker_error',code:error.code || 'internal'}));
      await setTimeout(10000);
    }
  }
} finally {await database.end();}
