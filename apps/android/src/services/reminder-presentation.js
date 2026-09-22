// One source can have many occurrences. Keep the displayed occurrence identity
// while its closing animation and asynchronous list refresh are in flight.
function occurrenceId(reminder){
  return JSON.stringify([reminder.key,reminder.rule,reminder.at]);
}
function nextForegroundReminder(rows,now,lastPresented){
  return rows.find(row=>!row.handledAt&&!row.deferred&&Date.parse(row.at)<=now&&occurrenceId(row)!==lastPresented);
}
module.exports={occurrenceId,nextForegroundReminder};
