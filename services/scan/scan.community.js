"use strict";

/*
=========================================
 services/scan/scan.community.js
=========================================

Community Intelligence Scanner

Sources:

- Website
- Twitter/X
- Telegram
- Discord
- Github

Output:

{
    followers,
    community_score,
    community_rating
}

=========================================
*/


/* ========================================
   HELPERS
======================================== */


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

    if(!value){

        return "";

    }


    return String(value)
        .toLowerCase();

}





/*
=========================================
 SOCIAL DETECTION
=========================================
*/


function detectSocialLinks(
    data={}
){


    const text =

        JSON.stringify(
            data
        )
        .toLowerCase();



    return {


        twitter:

            text.includes(
                "twitter"
            )
            ||
            text.includes(
                "x.com"
            ),



        telegram:

            text.includes(
                "telegram"
            ),



        discord:

            text.includes(
                "discord"
            ),



        youtube:

            text.includes(
                "youtube"
            ),



        medium:

            text.includes(
                "medium"
            )


    };


}







/*
=========================================
 COMMUNITY SCORE
=========================================
*/


function calculateCommunityScore(
    data={}
){


    let score = 0;



    /*
    ===============================
       FOLLOWERS
    ===============================
    */


    const followers =
        number(
            data.followers
        );



    if(
        followers >= 500000
    ){

        score += 35;

    }

    else if(
        followers >= 100000
    ){

        score += 28;

    }

    else if(
        followers >= 50000
    ){

        score += 20;

    }

    else if(
        followers >= 10000
    ){

        score += 12;

    }

    else if(
        followers >= 1000
    ){

        score += 5;

    }





    /*
    ===============================
       SOCIAL CHANNELS
    ===============================
    */


    const social =
        data.social || {};



    if(
        social.twitter
    ){

        score += 10;

    }


    if(
        social.telegram
    ){

        score += 10;

    }


    if(
        social.discord
    ){

        score += 10;

    }


    if(
        social.youtube
    ){

        score += 5;

    }


    if(
        social.medium
    ){

        score += 5;

    }





    /*
    ===============================
       ACTIVITY
    ===============================
    */


    const activity =
        number(
            data.activity
        );



    if(
        activity >= 50
    ){

        score += 15;

    }

    else if(
        activity >= 20
    ){

        score += 10;

    }

    else if(
        activity > 0
    ){

        score += 5;

    }



    return Math.min(
        score,
        100
    );


}





/*
=========================================
 RATING
=========================================
*/


function communityRating(score){


    if(score >= 80){

        return "excellent";

    }


    if(score >= 60){

        return "strong";

    }


    if(score >= 40){

        return "average";

    }


    if(score >= 20){

        return "weak";

    }


    return "poor";


}







/*
=========================================
 MAIN SCANNER
=========================================
*/


async function scanCommunity(
    context={}
){



    const project =
        context.project || {};



    const website =
        context.website
        ||
        {};



    const github =
        context.github
        ||
        {};



    const socialData = {


        ...website,


        ...project,


        ...github


    };





    const social =
        detectSocialLinks(
            socialData
        );





    /*
    =================================
       FOLLOWERS SOURCE
    =================================
    */


    const followers =

        number(

            project.followers

            ||

            website.followers

            ||

            website.twitter_followers

            ||

            github.followers

            ||

            0

        );







    /*
    =================================
       ACTIVITY
    =================================
    */


    const activity =


        number(

            github.github_recent_commits

            ||

            github.commits

            ||

            0

        );







    const community = {


        followers,


        social,


        activity


    };





    const score =

        calculateCommunityScore(
            community
        );





    return {


        project_id:

            project.id,



        followers,



        twitter:

            social.twitter,



        telegram:

            social.telegram,



        discord:

            social.discord,



        youtube:

            social.youtube,



        medium:

            social.medium,



        community_score:

            score,



        community_rating:

            communityRating(
                score
            )



    };


}






module.exports = {


    scanCommunity,


    calculateCommunityScore,


    detectSocialLinks,


    communityRating


};