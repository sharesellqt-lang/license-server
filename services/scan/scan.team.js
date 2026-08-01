// =========================================
// services/scan/scan.team.js
// =========================================

"use strict";


const teamService =
    require("../airdrop.team.service");



/* =========================================
   HELPERS
========================================= */


function number(value){

    value =
        Number(value);


    if(
        !Number.isFinite(value)
    ){

        return 0;

    }


    return value;

}



function normalizeText(value){

    return String(
        value || ""
    )
    .toLowerCase();

}





/* =========================================
   SCORE
========================================= */


function calculateTeamScore(
    members=[]
){

    if(
        !Array.isArray(members) ||
        members.length === 0
    ){

        return 0;

    }


    let score = 0;



    /*
    =====================================
       TEAM SIZE
    =====================================
    */


    const count =
        members.length;


    if(
        count >= 10
    ){

        score += 15;

    }

    else if(
        count >= 5
    ){

        score += 10;

    }

    else if(
        count >= 2
    ){

        score += 5;

    }




    /*
    =====================================
       EXPERIENCE
    =====================================
    */


    let experienced = 0;


    members.forEach(member=>{


        const exp =
            number(
                member.years_experience ||
                member.experience_years
            );


        if(
            exp >= 5
        ){

            experienced++;

        }


    });



    if(
        experienced >= 5
    ){

        score += 25;

    }

    else if(
        experienced >= 2
    ){

        score += 15;

    }

    else if(
        experienced >= 1
    ){

        score += 8;

    }





    /*
    =====================================
       WEB3 EXPERIENCE
    =====================================
    */


    const web3Keywords = [

        "ethereum",

        "binance",

        "polygon",

        "solana",

        "defi",

        "crypto",

        "web3",

        "blockchain",

        "aave",

        "uniswap",

        "chainlink"

    ];



    let web3Count = 0;



    members.forEach(member=>{


        const text =

            normalizeText(

                (

                    member.bio ||

                    ""

                )
                +

                " "

                +

                (

                    member.previous_projects ||

                    ""

                )

            );



        if(

            web3Keywords.some(

                k =>
                text.includes(k)

            )

        ){

            web3Count++;

        }


    });





    if(
        web3Count >= 5
    ){

        score += 30;

    }

    else if(
        web3Count >= 2
    ){

        score += 20;

    }

    else if(
        web3Count >= 1
    ){

        score += 10;

    }





    /*
    =====================================
       LINKEDIN / VERIFIED
    =====================================
    */


    let verified = 0;



    members.forEach(member=>{


        if(

            member.linkedin ||

            member.twitter ||

            member.profile_url

        ){

            verified++;

        }


    });



    if(
        verified >= 5
    ){

        score += 20;

    }

    else if(
        verified >= 2
    ){

        score += 10;

    }





    return Math.min(

        score,

        100

    );

}





/* =========================================
   SCAN TEAM
========================================= */


async function scanTeam(
    context={}
){

    const project =
        context.project || {};



    const projectId =
        context.projectId;



    if(!projectId){


       return {

    team_score,

    members,

    founders,

    linkedin_score

}


    }





    const members =
        await teamService.getTeamByProject(

            projectId

        );





    const score =
        calculateTeamScore(
            members
        );



console.log("========== TEAM RESULT ==========");
console.log(result);

    return {


        /*
        ===============================
           MEMBERS
        ===============================
        */


        team_count:

            members.length,


        team_members:

            members.map(member=>({


                name:
                    member.name || "",


                role:
                    member.role || "",


                linkedin:
                    member.linkedin || "",


                twitter:
                    member.twitter || ""


            })),




        /*
        ===============================
           SCORE
        ===============================
        */


        team_score:

            score,


        founder_score:

            score


    };


}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanTeam,


    calculateTeamScore


};