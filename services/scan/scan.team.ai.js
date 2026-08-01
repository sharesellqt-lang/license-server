// =========================================
// services/scan/scan.team.ai.js
// =========================================

"use strict";


const teamService =
    require("../airdrop.team.service");



/* =========================================
   HELPERS
========================================= */


function clean(value = "") {

    return String(value)

        .replace(
            /\s+/g,
            " "
        )

        .trim();

}



function normalize(value = "") {

    return String(value)

        .toLowerCase()

        .trim();

}



/*
=========================================
REMOVE HTML
=========================================
*/


function stripHtml(html = "") {

    return html

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

}




/*
=========================================
SOCIAL FINDER
=========================================
*/


function extractSocial(text = "") {


    let linkedin = "";

    let twitter = "";



    const linkedinMatch =

        text.match(
            /https?:\/\/(www\.)?linkedin\.com\/[^\s"'<>]+/i
        );


    if(linkedinMatch){

        linkedin =
            linkedinMatch[0];

    }



    const twitterMatch =

        text.match(
            /https?:\/\/(twitter\.com|x\.com)\/[^\s"'<>]+/i
        );


    if(twitterMatch){

        twitter =
            twitterMatch[0];

    }



    return {

        linkedin,

        twitter

    };


}





/*
=========================================
POSITION DETECT
=========================================
*/


function detectPosition(
    text=""
){


    const t =
        normalize(text);



    const roles = [


        "ceo",

        "cto",

        "cfo",

        "coo",

        "founder",

        "co-founder",

        "chief executive",

        "advisor",

        "marketing",

        "developer",

        "engineer",

        "lead"

    ];



    for(const role of roles){


        if(
            t.includes(role)
        ){

            return role;

        }

    }



    return "";

}





/*
=========================================
TEAM EXTRACTION
=========================================
*/


function extractTeamFromHTML(
    html=""
){


    const text =
        stripHtml(html);



    const lines =

        text

        .split(
            /\n|\r/
        )

        .map(clean)

        .filter(
            x =>
            x.length > 3
        );



    const members = [];



    for(
        let i = 0;
        i < lines.length;
        i++
    ){


        const line =
            lines[i];



        const position =
            detectPosition(
                line
            );



        if(!position)
            continue;



        const social =
            extractSocial(
                line
            );



        let name =
            line;



        /*
        remove role
        */


        name =
            name

            .replace(
                /ceo|cto|cfo|coo|founder|advisor/gi,
                ""
            )

            .trim();



        if(
            name.length < 2
        )
            continue;




       members.push({

    member_name: name,

    position,

    linkedin:
        social.linkedin || "",


    twitter:
        social.twitter || "",


    previous_company:
        "",


    experience_years:
        0,


    github:
        social.github || "",


    avatar:
        "",


    verification_level:
        "low",


    source_url:
        sourceUrl || "",


    influence_score:
        0,


    is_founder:
        0,


    note:
        line || ""

});

    }



    return members;

}





/*
=========================================
DEDUP
=========================================
*/


function removeDuplicate(
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





/*
=========================================
SAVE DATABASE
=========================================
*/


async function saveTeam(
    projectId,
    members=[]
){


    if(
        !members.length
    )
        return;



    for(
        const member of members
    ){


        await teamService.upsertMember(

            projectId,

            member

        );


    }


}





/*
=========================================
MAIN
=========================================
*/


async function scanTeamAI(
    context={}
){


    const project =
        context.project || {};



    const projectId =
        context.projectId;



    const html =
        context.html ||
        "";



    if(
        !projectId ||
        !html
    ){


        return {

            team_count:0,

            members:[]

        };


    }




    let members =

        extractTeamFromHTML(
            html
        );



    members =

        removeDuplicate(
            members
        );




    await saveTeam(

        projectId,

        members

    );



    console.log(
        "========== TEAM AI =========="
    );


    console.table(
        members
    );



    return {


        team_count:

            members.length,


        members


    };


}





module.exports = {


    scanTeamAI,


    extractTeamFromHTML,


    removeDuplicate


};