// =========================================
// services/collectors/linkedin.collector.js
// =========================================

"use strict";

const fetch =
    global.fetch ||
    require("node-fetch");

/*
======================================================
LINKEDIN COLLECTOR

Supported Provider:
- Proxycurl

If no API key exists or request fails,
the collector safely returns an empty profile.

No exception is thrown.
======================================================
*/

const API =
    "https://nubela.co/proxycurl/api/v2/linkedin";

const API_KEY =
    process.env.PROXYCURL_API_KEY;

/* =========================================
   HELPERS
========================================= */

function number(value){

    value = Number(value);

    if(!Number.isFinite(value)){

        return 0;

    }

    return value;

}

/* =========================================
   YEAR DIFFERENCE
========================================= */

function yearsBetween(date){

    if(!date){

        return 0;

    }

    const start =
        new Date(date);

    if(Number.isNaN(start.getTime())){

        return 0;

    }

    const now =
        new Date();

    let years =
        now.getFullYear() -
        start.getFullYear();

    const monthDiff =
        now.getMonth() -
        start.getMonth();

    if(

        monthDiff < 0 ||

        (

            monthDiff === 0 &&

            now.getDate() <
            start.getDate()

        )

    ){

        years--;

    }

    return Math.max(0, years);

}

/* =========================================
   REQUEST
========================================= */

async function request(profileUrl){

    if(!API_KEY){

        console.log(
            "LinkedIn: Proxycurl disabled (missing API key)"
        );

        return null;

    }

    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            ()=>controller.abort(),
            10000
        );

    try{

        const res =
            await fetch(

                `${API}?url=${encodeURIComponent(profileUrl)}`,

                {

                    headers:{

                        Authorization:
                            `Bearer ${API_KEY}`,

                        Accept:
                            "application/json"

                    },

                    signal:
                        controller.signal

                }

            );

        clearTimeout(timeout);

        if(!res.ok){

            console.log(

                "LinkedIn:",

                res.status

            );

            return null;

        }

        return await res.json();

    }

    catch(err){

        console.log(

            "LinkedIn:",

            err.message

        );

        return null;

    }

    finally{

        clearTimeout(timeout);

    }

}

/* =========================================
   EXPERIENCE
========================================= */

function calculateExperience(profile={}){

    const jobs =
        Array.isArray(profile.experiences)
            ? profile.experiences
            : [];

    let total = 0;

    for(const job of jobs){

        const start =

            job.starts_at?.date ||

            job.starts_at ||

            job.start_date ||

            null;

        total +=
            yearsBetween(start);

    }

    return total;

}

/* =========================================
   BIG COMPANIES
========================================= */

function countBigCompanies(profile={}){

    const jobs =
        Array.isArray(profile.experiences)
            ? profile.experiences
            : [];

    const keywords = [

        "google",
        "meta",
        "facebook",
        "microsoft",
        "amazon",
        "apple",

        "binance",
        "coinbase",
        "consensys",
        "polygon",
        "ethereum",
        "solana",
        "chainlink",
        "arbitrum",
        "optimism",
        "aave",
        "ripple"

    ];

    let count = 0;

    for(const job of jobs){

        const company =

            String(

                job.company ||

                job.company_name ||

                ""

            )

            .toLowerCase();

        if(

            keywords.some(

                k=>company.includes(k)

            )

        ){

            count++;

        }

    }

    return count;

}

/* =========================================
   EDUCATION
========================================= */

function countEducation(profile={}){

    return Array.isArray(profile.education)

        ? profile.education.length

        : 0;

}

/* =========================================
   FOLLOWERS
========================================= */

function followerCount(profile={}){

    return number(

        profile.follower_count ||

        profile.followers ||

        0

    );

}

/* =========================================
   SCORE
========================================= */

function calculateScore(data={}){

    let score = 0;

    /* experience */

    if(data.total_experience >= 10){

        score += 30;

    }

    else if(data.total_experience >= 5){

        score += 20;

    }

    else if(data.total_experience >= 2){

        score += 10;

    }

    /* companies */

    if(data.big_companies >= 3){

        score += 35;

    }

    else if(data.big_companies >= 2){

        score += 25;

    }

    else if(data.big_companies >= 1){

        score += 15;

    }

    /* education */

    if(data.education_count >= 2){

        score += 10;

    }

    else if(data.education_count >= 1){

        score += 5;

    }

    /* followers */

    if(data.followers >= 10000){

        score += 25;

    }

    else if(data.followers >= 3000){

        score += 15;

    }

    else if(data.followers >= 1000){

        score += 8;

    }

    return Math.min(score,100);

}

/* =========================================
   MAIN
========================================= */

async function fetchProfile(profileUrl){

    if(!profileUrl){

        return {

            linkedin_url:"",
            linkedin_score:0

        };

    }

    const profile =
        await request(profileUrl);

    if(!profile){

        return {

            linkedin_url:
                profileUrl,

            full_name:"",
            headline:"",
            location:"",
            followers:0,
            total_experience:0,
            big_companies:0,
            education_count:0,
            current_company:"",
            profile_photo:"",
            public_identifier:"",
            linkedin_score:0

        };

    }

    const totalExperience =
        calculateExperience(profile);

    const companies =
        countBigCompanies(profile);

    const education =
        countEducation(profile);

    const followers =
        followerCount(profile);

    const linkedinScore =
        calculateScore({

            total_experience:
                totalExperience,

            big_companies:
                companies,

            education_count:
                education,

            followers

        });

    const result = {

        linkedin_url:
            profileUrl,

        profile_id:
            profile.profile_id ||

            "",

        public_identifier:
            profile.public_identifier ||

            "",

        full_name:
            profile.full_name ||

            "",

        headline:
            profile.headline ||

            "",

        location:

            profile.city ||

            profile.location ||

            "",

        followers,

        total_experience:
            totalExperience,

        big_companies:
            companies,

        education_count:
            education,

        current_company:

            profile.occupation ||

            "",

        profile_photo:

            profile.profile_pic_url ||

            "",

        linkedin_score:
            linkedinScore

    };

    console.table({

        name:
            result.full_name,

        followers:
            result.followers,

        experience:
            result.total_experience,

        companies:
            result.big_companies,

        education:
            result.education_count,

        score:
            result.linkedin_score

    });

    return result;

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchProfile,

    calculateExperience,

    calculateScore

};