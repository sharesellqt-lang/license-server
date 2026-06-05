const express = require("express");
const router = express.Router();

const db = require("../db");

const TOOLS =
require("../permissions/tool.permissions");

router.get(
"/feature-access",
async(req,res)=>{

 const {
   userId,
   tool,
   feature
 } = req.query;

 const config =
 TOOLS?.[tool]
 ?.features?.[feature];

 if(!config){

   return res.json({
     allowed:false
   });

 }

 const user =
 await db.query(
   "SELECT plan FROM users WHERE id=?",
   [userId]
 );

 const plan =
 user[0]?.plan || "free";

 const rank = {
   free:0,
   pro:1,
   vip:2
 };

 if(
 rank[plan] >=
 rank[config.requiredPlan]
 ){

   return res.json({
     allowed:true
   });

 }

 const [trial] =
 await db.query(
`
SELECT *
FROM user_feature_trials
WHERE user_id=?
AND feature_key=?
AND expires_at > NOW()
`,
[
 userId,
 tool+"."+feature
]
 );

 if(trial){

   return res.json({
     allowed:true,
     source:"trial"
   });

 }

 return res.json({
   allowed:false
 });

});

module.exports = router;