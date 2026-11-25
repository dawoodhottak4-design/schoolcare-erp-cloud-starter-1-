try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json({limit:'100kb'}));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
app.use(express.static(path.join(__dirname,'public')));
const PORT = process.env.PORT || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const db = supabaseUrl && supabaseKey ? createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}}) : null;
const clean = v => typeof v === 'string' ? v.trim() : v;
const phoneDigits = raw => String(raw||'').replace(/\D/g,'');
function normalizePhone(raw){let n=phoneDigits(raw);if(n.startsWith('0'))n='92'+n.slice(1);if(n.startsWith('3')&&n.length===10)n='92'+n;return n;}
function needDb(req,res,next){if(!db)return res.status(503).json({error:'Database is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env, then restart the server.'});next()}
app.get('/api/health',(req,res)=>res.json({server:true,database:!!db,whatsappConfigured:!!(process.env.WA_ACCESS_TOKEN&&process.env.WA_PHONE_NUMBER_ID&&process.env.WA_TEMPLATE_NAME)}));
app.get('/api/students',needDb,async(req,res)=>{const {data,error}=await db.from('students').select('id,student_name,admission_number,class_name,parent_id').order('student_name');if(error)return res.status(400).json({error:error.message});res.json({students:data})});
app.post('/api/students',needDb,async(req,res)=>{
 const b=req.body||{};const student_name=clean(b.student_name),parent_name=clean(b.parent_name),whatsapp_number=normalizePhone(b.whatsapp_number);
 if(!student_name||!parent_name||!/^92\d{10}$/.test(whatsapp_number))return res.status(400).json({error:'Student name, parent name, and valid Pakistan WhatsApp number (92XXXXXXXXXX) are required.'});
 if(b.consent_given!==true)return res.status(400).json({error:'Parent/guardian consent is required before WhatsApp notifications can be enabled.'});
 const {data:p,error:pe}=await db.from('parents').insert({parent_name,whatsapp_number,consent_given:true}).select().single();
 if(pe)return res.status(400).json({error:pe.message});
 const payload={student_name,admission_number:clean(b.admission_number)||null,class_name:clean(b.class_name)||null,parent_id:p.id};
 const {data:s,error:se}=await db.from('students').insert(payload).select().single();
 if(se){await db.from('parents').delete().eq('id',p.id);return res.status(400).json({error:se.message})}
 res.status(201).json({student:s,parent:p});
});
app.delete('/api/students/:id',needDb,async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Invalid student ID.'});
 const {data:student}=await db.from('students').select('id,parent_id').eq('id',id).single();
 if(!student)return res.status(404).json({error:'Student not found.'});
 const {data:atts}=await db.from('attendance').select('id').eq('student_id',id);
 const attIds=(atts||[]).map(a=>a.id);
 if(attIds.length>0){await db.from('notifications').delete().in('attendance_id',attIds);}
 await db.from('attendance').delete().eq('student_id',id);
 const {error:delErr}=await db.from('students').delete().eq('id',id);
 if(delErr)return res.status(400).json({error:delErr.message});
 if(student.parent_id){
  const {data:siblings}=await db.from('students').select('id').eq('parent_id',student.parent_id);
  if(!siblings||siblings.length===0){await db.from('parents').delete().eq('id',student.parent_id);}
 }
 res.json({success:true});
});
async function sendWhatsAppTemplate({phone,student,status,date}){
 const {WA_ACCESS_TOKEN,WA_PHONE_NUMBER_ID,WA_TEMPLATE_NAME}=process.env;
 if(!WA_ACCESS_TOKEN||!WA_PHONE_NUMBER_ID||!WA_TEMPLATE_NAME)return {sent:false,status:'Pending',reason:'WhatsApp Cloud API credentials/template are not configured on the server.'};
 const version=process.env.WA_GRAPH_VERSION||'v23.0';
 const language=process.env.WA_TEMPLATE_LANGUAGE||'en_US';
 const body={messaging_product:'whatsapp',to:phone,type:'template',template:{name:WA_TEMPLATE_NAME,language:{code:language},components:[{type:'body',parameters:[{type:'text',text:student},{type:'text',text:status},{type:'text',text:date}]}]}};
 const response=await fetch(`https://facebook.com{version}/${WA_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${WA_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok) return {sent:false,status:'Failed',reason:data?.error?.message||JSON.stringify(data)};
 const msgId=(data&&data.messages&&data.messages[0])?data.messages[0].id:null;
 return {sent:true,status:'Sent',messageId:msgId};
}
app.post('/api/attendance',needDb,async(req,res)=>{
 const b=req.body||{};const studentId=Number(b.student_id);const date=clean(b.attendance_date);const status=clean(b.status);
 if(!Number.isInteger(studentId)||studentId<1||!date||!['Present','Absent','Late'].includes(status))return res.status(400).json({error:'Select a student, valid date, and Present/Absent/Late status.'});
 const {data:student,error:studentErr}=await db.from('students').select('id,student_name,class_name,parents(id,parent_name,whatsapp_number,consent_given)').eq('id',studentId).single();
 if(studentErr||!student)return res.status(404).json({error:'Student not found.'});
 const {data:att,error:attErr}=await db.from('attendance').insert({student_id:studentId,attendance_date:date,status}).select().single();
 if(attErr){if(attErr.code==='23505')return res.status(409).json({error:'Attendance for this student and date already exists. Avoid duplicate marking.'});return res.status(400).json({error:attErr.message})}
 const parent=student.parents;
 if(!parent||!parent.consent_given){await db.from('notifications').insert({attendance_id:att.id,parent_id:parent?.id||null,message:`Attendance ${status} for ${student.student_name}`,status:'Blocked: no consent'});return res.json({attendance:att,notification:{status:'Blocked: no consent',message:'Attendance saved. WhatsApp not sent because parent consent is missing.'}})}
 const result=await sendWhatsAppTemplate({phone:parent.whatsapp_number,student:student.student_name,status,date});
 const noteMessage=`Attendance ${status} for ${student.student_name} on ${date}`;
 await db.from('notifications').insert({attendance_id:att.id,parent_id:parent.id,message:noteMessage,status:result.status,sent_at:result.sent?new Date().toISOString():null});
 res.json({attendance:att,notification:{status:result.status,message:result.sent?'Attendance saved and WhatsApp API accepted the message. Delivery confirmation may arrive via Meta webhook.':`Attendance saved. WhatsApp ${result.status.toLowerCase()}: ${result.reason||'Not configured'}` }});
});
app.get('/api/records',needDb,async(req,res)=>{
 const [s,a,n]=await Promise.all([
 db.from('students').select('id,student_name,admission_number,class_name,parents(parent_name,whatsapp_number)').order('id',{ascending:false}).limit(200),
 db.from('attendance').select('id,attendance_date,status,students(student_name,class_name),notifications(status)').order('id',{ascending:false}).limit(200),
 db.from('notifications').select('attendance_id,status')
 ]);
 if(s.error||a.error)return res.status(400).json({error:s.error?.message||a.error?.message});
 const statusById=new Map((n.data||[]).map(x=>[x.attendance_id,x.status]));
 res.json({students:s.data,attendance:a.data.map(x=>({...x,notification_status:statusById.get(x.id)||'Not sent'}))});
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`SchoolCare ERP running at http://localhost:${PORT}`));
