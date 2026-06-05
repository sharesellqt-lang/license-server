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
async (req, res) => {

try {

const {
 userId,
 feature
} = req.query;

const config =
PERMISSIONS
?.global
?.features?.[
 feature
];

if (!config) {

 return res.json({
   allowed:false
 });

}

// =======================
// USER PLAN
// =======================

const [rows] =
await db.query(
`
SELECT plan
FROM users
WHERE id=?
`,
[userId]
);

const plan =
(
 rows[0]?.plan ||
 "free"
)
.toLowerCase();

const rank = {
 free:0,
 pro:1,
 vip:2
};

// =======================
// PLAN ACCESS
// =======================

if (

 rank[plan] >=
 rank[
   config.requiredPlan
 ]

) {

 return res.json({

   allowed:true,
   source:"plan"

 });

}

// =======================
// TRIAL ACCESS
// =======================

const [trialRows] =
await db.query(

`
SELECT *
FROM user_feature_trials
WHERE user_id=?
AND feature_key=?
AND expires_at > NOW()
LIMIT 1
`,

[
 userId,
 feature
]

);

if (

 trialRows.length

) {

 return res.json({

   allowed:true,
   source:"trial"

 });

}

// =======================
// DENY
// =======================

return res.json({

 allowed:false

});

} catch (err) {

 console.error(
   "FEATURE ACCESS ERROR:",
   err
 );

 return res
 .status(500)
 .json({

   allowed:false

 });

}

});

// =======================
// ACTIVATE FEATURE TRIAL
// =======================

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
req.user.id;

console.log(
"USER ID:",
userId
);

const {
 feature
} = req.body;

if(!feature){

 return res
 .status(400)
 .json({

   error:
   "Feature required"

 });

}

// =======================
// EXPIRE TIME
// =======================

const expires =
new Date();

if(

 feature ===
 "proMode"

){

 expires.setDate(

   expires.getDate()
   + 3

 );

}else{

 expires.setDate(

   expires.getDate()
   + 1

 );

}

// =======================
// UPSERT TRIAL
// =======================

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

ON DUPLICATE KEY UPDATE

expires_at =
VALUES(expires_at)

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

return res.json({

 success:true,

 feature,

 expiresAt:
 expires

});

}catch(err){

console.error(

"ACTIVATE ERROR:",

err

);

return res
.status(500)
.json({

 error:
 err.message

});

}

});

module.exports =
router;