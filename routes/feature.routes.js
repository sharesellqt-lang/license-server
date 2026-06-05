const express = require("express");
const router = express.Router();

const db = require("../db");

const authMiddleware =
require("../middleware/auth");

const PERMISSIONS =
require("../permissions/tool.permissions");

// =======================
// CHECK FEATURE ACCESS
// =======================

router.get(
"/feature-access",
async(req,res)=>{

try{

const {
 userId,
 feature
} = req.query;

const config =
PERMISSIONS.global.features[
 feature
];

if(!config){

 return res.json({
   allowed:false
 });

}

const [users] =
await db.query(
"SELECT plan FROM users WHERE id=?",
[userId]
);

const plan =
(users?.plan || "free")
.toLowerCase();

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
   allowed:true,
   source:"plan"
 });

}

const [trial] =
await db.query(
`
SELECT *
FROM user_feature_trials
WHERE user_id=?
AND feature_key=?
AND is_active=1
AND expires_at > NOW()
LIMIT 1
`,
[
 userId,
 feature
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

}catch(err){

 console.log(err);

 res.status(500).json({
   allowed:false
 });

}

});

module.exports = router;
router.post(
"/activate-feature-trial",
authMiddleware,
async (req,res)=>{

 try{

   console.log(
     "BODY:",
     req.body
   );

   console.log(
     "USER:",
     req.user
   );

   const userId =
     req.user.userId ||
     req.user.id;

   console.log(
     "USER ID:",
     userId
   );

   const {
     feature
   } = req.body;

   const expires =
     new Date();

   if(feature==="proMode"){

     expires.setDate(
       expires.getDate()+3
     );

   }else{

     expires.setDate(
       expires.getDate()+1
     );

   }

   await db.query(

`
INSERT INTO
user_feature_trials
(
 user_id,
 feature_key,
 expires_at
)

VALUES
(
 ?,
 ?,
 ?
)
`,

[
 userId,
 feature,
 expires
]

);

   console.log(
     "TRIAL INSERTED"
   );

   res.json({
     success:true
   });

 }catch(err){

   console.error(
     "ACTIVATE ERROR:",
     err
   );

   res.status(500)
   .json({
     error:
       err.message
   });

 }

});