const db=require("../db");
const plans=require("../services/planConfig");
const {canAccessFeature}=require("../services/feature.service");
const imageAI=require("../services/image-studio/image-ai.service");
const enabled=()=>String(process.env.IMAGE_STUDIO_AI_ENABLED||"false").toLowerCase()==="true";
exports.getConfig=(req,res)=>res.json({aiEnabled:enabled()});
exports.edit=async(req,res)=>{
  try{
    if(!enabled())return res.status(503).json({error:"AI Image Studio is currently disabled."});
    if(!req.file)return res.status(400).json({error:"Missing or unsupported image file."});
    const prompt=String(req.body.prompt||"").trim();
    if(!prompt||prompt.length>1000)return res.status(400).json({error:"Prompt must contain 1–1000 characters."});
    const [rows]=await db.query("SELECT id,email,plan,expire_at FROM users WHERE id=? LIMIT 1",[req.user.id]);
    if(!rows.length)return res.status(401).json({error:"User not found."});
    const allowed=req.user.isAdmin||await canAccessFeature(rows[0],"vipMode");
    if(!allowed)return res.status(403).json({error:"VIP access required."});
    const plan=String(req.user.plan||"free").toLowerCase(),limit=plans["image-studio"]?.[plan];
    if(limit!==undefined&&limit!==-1){
      const [usage]=await db.query("SELECT COUNT(*) AS total FROM usage_logs WHERE user_id=? AND action=? AND DATE(created_at)=CURDATE()",[req.user.id,"image-studio"]);
      if(Number(usage[0].total)>=limit)return res.status(429).json({error:"Daily Image Studio AI limit reached.",used:Number(usage[0].total),limit});
    }
    const image=await imageAI.edit({buffer:req.file.buffer,mimeType:req.file.mimetype,prompt});
    await db.query("INSERT INTO usage_logs(user_id,action) VALUES(?,?)",[req.user.id,"image-studio"]);
    res.json({success:true,image:`data:${image.mimeType};base64,${image.base64}`});
  }catch(err){console.error("[IMAGE STUDIO AI]",err);res.status(500).json({error:err.message||"Image editing failed."});}
};