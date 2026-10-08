(function(root){
const sentences=t=>t.split(/\n+|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
function createPlan(original,message){
 if(!original.trim()||!message.trim())throw Error('Both inputs are required.');
 const parts=sentences(message); const booking=/\b(bookings?|appointments?|reservations?)\b/i.test(original+" "+message); const changes=parts.map(text=>({text,type:/\b(remove|drop|no longer|without|don't need|do not need|cancel)\b/i.test(text)?'Removal':/\b(instead|replace|change|switch|rather|now|only)\b/i.test(text)?'Modification':'Requested scope'}));
 const questions=['Which of these changes are approved for this release, and which should be deferred?','Does this change affect the agreed budget, delivery date, or existing completed work?'];
 if(/\b(payments?|pay|deposit|checkout|bkash|nagad|stripe)\b/i.test(message))questions.push('Which payment provider, currency, refund flow, and payment confirmation rules should be supported?');
 if(/\b(users?|admins?|roles?|login|customers?)\b/i.test(message))questions.push('Which roles can access the new behavior, and what should unauthorized users see?');
 if(/\b(emails?|notifications?|sms|alerts?)\b/i.test(message))questions.push('What triggers each notification, who receives it, and what content or delivery channel is required?');
 if(/\b(reports?|exports?|dashboards?|analytics)\b/i.test(message))questions.push('What fields, filters, date ranges, and export formats must the report include?');
 questions.push('What observable example would the client accept as proof that each requested change is complete?');
 const tasks=changes.map((c,i)=>({title:`${c.type==='Removal'?'Remove':'Implement'} requested change ${i+1}`,description:c.text,criteria:[c.type==='Removal'?'The approved behavior is removed from the relevant user flow.':'The approved request is available in the relevant user flow and matches a client-confirmed example.','Relevant invalid, empty, and permission-denied cases have agreed behavior.','Existing agreed behavior remains functional unless explicitly superseded.']}));
  tasks.forEach((t,i)=>{
  const text=changes[i].text;
  if(changes[i].type==='Removal'){t.title='Remove superseded behavior';t.criteria[0]='The behavior described in this request is unavailable in the approved user flow: '+text;return;}
  if(/\b(pay|payment|deposit|bkash|checkout)\b/i.test(text)&&!/\b(email|notification)\b/i.test(text)){
   t.title=booking?'Add booking payment flow':'Implement requested payment flow';t.criteria=['The agreed payable amount is displayed before the customer initiates payment.',booking?'A booking is confirmed only after the server verifies a successful payment for that booking.':'The transaction is marked paid only after server-side verification from the approved provider.','Failed, cancelled, and duplicate callbacks do not create a successful or duplicate transaction.','Provider, currency, amount calculation, and refund rules are confirmed with the client.'];
  }else if(/\b(emails?|notifications?|sms|alerts?)\b/i.test(text)){
   t.title='Add requested customer notification';t.criteria=['The notification is sent only when the client-approved triggering event occurs.','The message contains the client-approved details and reaches the intended recipient.','Retries do not send duplicate confirmations; failed delivery is recorded for review.'];
  }else if(/\b(report|export|analytics)\b/i.test(text)){
   t.title='Build report and export flow';t.criteria=['A user with the agreed reporting permission can select the reporting period and see matching records.','The export contains the agreed columns and the same filtered records shown in the report.','Empty periods, date boundaries, and unauthorized access follow client-approved rules.'];
  }else{t.title='Implement: '+text.slice(0,90)+(text.length>90?'…':'');}
 });
 return {original:original.trim(),message:message.trim(),changes,tasks,questions};
}
if(typeof module!=='undefined')module.exports={createPlan};else root.createPlan=createPlan;
})(globalThis);
