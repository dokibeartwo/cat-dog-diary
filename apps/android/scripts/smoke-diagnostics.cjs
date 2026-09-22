const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

// Full-resolution screensaver PNGs exceed execFileSync's default pipe buffer.
// Stream stdout straight to the artifact; keep the command timeout bounded.
function captureFile(file,command,args){
  const fd=fs.openSync(file,'w');
  try{execFileSync(command,args,{stdio:['ignore',fd,'pipe'],timeout:30000,maxBuffer:8*1024*1024});}
  finally{fs.closeSync(fd);}
  if(!fs.statSync(file).size)throw Error(`Empty diagnostic: ${path.basename(file)}`);
}

async function recordFailure(output,{error,checks,warnings},captures){
  const report={passed:false,checks,warnings,error:error.message,code:error.code,diagnosticErrors:[]};
  const save=()=>fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));
  // Record the original failure even if the device or its screenshot service
  // is unavailable. Secondary capture failures must never replace the cause.
  save();
  for(const [name,capture]of Object.entries(captures)){
    try{await capture();}catch(failure){report.diagnosticErrors.push({name,error:failure.message});}
  }
  save();
}
module.exports={captureFile,recordFailure};
