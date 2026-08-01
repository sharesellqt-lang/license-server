// =========================================
// services/scan/scan.team.ai.js
// =========================================

"use strict";


const teamService =
    require("../airdrop.team.service");



/* =========================================
   HELPERS
========================================= */


function clean(value=""){

    return String(value)

        .replace(
            /\s+/g,
            " "
        )

        .trim();

}



function normalize(value=""){

    return clean(value)
        .toLowerCase();

}



function extractUrl(
    text,
    keyword
){

    const regex =
        new RegExp(
            `${keyword}[^\\s"']+`,
            "i"
        );


    const match =
        text.match(regex);


    return match
        ? match[0]
        : "";

}





/* =========================================
   FIND PEOPLE
========================================= */


function extractMembers(
    html=""
){


    const members=[];


    if(!html){

        return members;

    }



    const text =

        html

        .replace(
            /<script[\s\S]*?<\/script>/gi,
            ""
        )

        .replace(
            /<style[\s\S]*?<\/style>/gi,
            ""
        )

        .replace(
            /<[^>]+>/g,
            " "
        );



    const lines =

        text

        .split("\n")

        .map(clean)

        .filter(
            x =>
            x.length > 3
        );




    const roles = [

        "founder",

        "co-founder",

        "ceo",

        "cto",

        "developer",

        "engineer",

        "advisor",

        "team"

    ];



    lines.forEach(line=>{


        const lower =
            normalize(line);



        const hasRole =

            roles.some(
                role =>
                lower.includes(role)
            );



        if(!hasRole){

            return;

        }



        let position =
            "";



        roles.forEach(role=>{

            if(
                lower.includes(role)
            ){

                position =
                    role;

            }

        });



        /*
        lấy tên phía trước role
        ví dụ:
        John Smith - CEO
        */


        let name =
            line

            .split(
                /[-|,:]/
            )[0];


        name =
            clean(name);



        if(
            name.length < 3 ||
            name.length > 80
        ){

            return;

        }



        members.push({


            member_name:

                name,


            position:

                position,


            linkedin:

                extractUrl(
                    line,
                    "linkedin.com"
                ),


            twitter:

                extractUrl(
                    line,
                    "twitter.com"
                )
                ||
                extractUrl(
                    line,
                    "x.com"
                ),


            github:

                extractUrl(
                    line,
                    "github.com"
                ),


            previous_company:

                "",


            experience_years:

                0,


            is_founder:

                (
                    position.includes(
                        "founder"
                    )
                    ||
                    position === "ceo"
                )
                ?1
                :0,


            verification_level:

                "low",


            source_url:

                "",


            influence_score:

                0


        });



    });



    return uniqueMembers(
        members
    );


}





/* =========================================
   REMOVE DUPLICATE
========================================= */


function uniqueMembers(
    members=[]
){

    const map =
        new Map();


    members.forEach(member=>{


        const key =

            normalize(
                member.member_name
            );



        if(
            !map.has(key)
        ){

            map.set(
                key,
                member
            );

        }


    });



    return [

        ...map.values()

    ];

}



/* =========================================
   SCAN TEAM AI
========================================= */


async function scanTeamAI(
    context={}
){

    const projectId =
        context.projectId;



    const html =
        context.html || "";



    if(!projectId){


        return {

            team_score:
                0,

            members:
                []

        };

    }



    const members =

        extractMembers(
            html
        );



    const saved=[];



    for(
        const member of members
    ){


   const id =

    await teamService.upsertMember(

        projectId,

        member

    );


const result = {

    action:"saved",

    id

};

        saved.push({

            ...member,

            ...result

        });


    }



    const total =

        await teamService.getMembers(
            projectId
        );


return {

    team_count:
        total.length,


    members:
        total,


    extracted:
        saved,


   team_score:

calculateAITeamScore(
    total
)

};


}


function calculateAITeamScore(
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
    TEAM SIZE
    */

    if(members.length >= 10){

        score += 20;

    }
    else if(members.length >= 5){

        score += 15;

    }
    else if(members.length >= 2){

        score += 10;

    }


    /*
    VERIFIED
    */

    const verified =

        members.filter(
            m =>
                m.linkedin ||
                m.twitter ||
                m.github
        )
        .length;


    if(verified >= 5){

        score += 30;

    }
    else if(verified >= 2){

        score += 20;

    }


    /*
    EXPERIENCE
    */

    const exp =

        members.filter(

            m =>
            Number(
                m.experience_years || 0
            ) >= 5

        )
        .length;


    if(exp >= 3){

        score += 30;

    }
    else if(exp >= 1){

        score += 15;

    }


    return Math.min(
        score,
        100
    );

}


/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanTeamAI,


    extractMembers,


    upsertMember


};