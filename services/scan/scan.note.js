// =========================================
// services/scan/scan.note.js
// =========================================

"use strict";


const noteRepository =
    require("../../repositories/note.repository");



/* =========================================
   HELPERS
========================================= */


function normalize(value){

    return String(
        value || ""
    )
    .toLowerCase();

}





/* =========================================
   RISK KEYWORDS
========================================= */


const HIGH_RISK_WORDS = [

    "scam",

    "rug",

    "rugpull",

    "fake",

    "fraud",

    "hack",

    "exploit",

    "drained",

    "malicious",

    "ponzi",

    "warning",

    "unsafe",

    "abandon"

];



const MEDIUM_RISK_WORDS = [

    "anonymous",

    "unverified",

    "low liquidity",

    "no audit",

    "high fdv",

    "unlock",

    "vesting",

    "centralized",

    "unknown team"

];





/* =========================================
   ANALYZE NOTES
========================================= */


function analyzeNotes(
    notes = []
){

    if(

        !Array.isArray(notes)

        ||

        notes.length === 0

    ){

        return {

            risk_score:0,

            flags:[]

        };

    }



    let riskScore = 0;


    const flags = [];





    notes.forEach(note=>{


        const content =

            normalize(

                note.content ||

                note.note ||

                note.text

            );



        HIGH_RISK_WORDS.forEach(word=>{


            if(

                content.includes(word)

            ){

                riskScore +=10;


                flags.push({

                    type:
                        "high",


                    keyword:
                        word

                });

            }


        });





        MEDIUM_RISK_WORDS.forEach(word=>{


            if(

                content.includes(word)

            ){

                riskScore +=5;


                flags.push({

                    type:
                        "medium",


                    keyword:
                        word

                });

            }


        });


    });





    return {


        risk_score:

            Math.min(

                riskScore,

                100

            ),



        flags


    };


}





/* =========================================
   NOTE QUALITY SCORE
========================================= */


function calculateNoteScore(
    notes=[]
){

    if(

        !Array.isArray(notes)

        ||

        notes.length===0

    ){

        return 0;

    }



    let score = 0;



    /*
    Research depth
    */


    if(
        notes.length >=10
    ){

        score +=30;

    }

    else if(
        notes.length >=5
    ){

        score +=20;

    }

    else if(
        notes.length >=2
    ){

        score +=10;

    }




    /*
    Verified notes
    */


    const verified =

        notes.filter(note=>

            note.source ||

            note.url ||

            note.reference

        )
        .length;



    if(
        verified >=5
    ){

        score +=30;

    }

    else if(
        verified >=2
    ){

        score +=15;

    }




    /*
    Analyst notes
    */


    const analyst =

        notes.filter(note=>

            normalize(
                note.type
            )
            ===
            "analysis"

        )
        .length;



    if(
        analyst >=3
    ){

        score +=20;

    }

    else if(
        analyst >=1
    ){

        score +=10;

    }




    /*
    Manual research
    */


    score +=20;



    return Math.min(

        score,

        100

    );

}





/* =========================================
   SCAN NOTE
========================================= */


async function scanNote(
    context={}
){

    const projectId =
        context.projectId;



    if(!projectId){


        return {

            note_score:0,

            risk_score:0,

            flags:[]

        };


    }





    const notes =

        await noteRepository.getByProject(

            projectId

        );





    const risk =

        analyzeNotes(

            notes

        );





    const score =

        calculateNoteScore(

            notes

        );





    return {


        note_count:

            notes.length,



        notes,



        note_score:

            score,



        risk_score:

            risk.risk_score,



        risk_flags:

            risk.flags


    };

}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanNote,


    analyzeNotes,


    calculateNoteScore


};