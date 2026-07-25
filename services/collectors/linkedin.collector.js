"use strict";

/* =========================================
   LINKEDIN COLLECTOR
========================================= */

const fetch =
    global.fetch ||
    require("node-fetch");

/*
---------------------------------------------
NOTE

LinkedIn does NOT provide a public API for
profile scraping.

This collector is designed to consume data
from:

- Proxycurl
- People Data Labs
- RapidAPI
- Internal scraper

If no API key exists it safely returns null.
---------------------------------------------
*/

const API =
    "https://nubela.co/proxycurl/api/v2/linkedin";

const API_KEY =
    process.env.PROXYCURL_API_KEY;

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

function yearsBetween(date){

    if(!date){

        return 0;

    }

    const start =
        new Date(date);

    const now =
        new Date();

    return Math.max(

        0,

        now.getFullYear() -

        start.getFullYear()

    );

}

/* =========================================
   REQUEST
========================================= */

async function request(url){

    if(
        !API_KEY
    ){

        return null;

    }

    const res =
        await fetch(

            `${API}?url=${encodeURIComponent(url)}`,

            {

                headers:{

                    Authorization:
                        `Bearer ${API_KEY}`

                }

            }

        );

    if(
        !res.ok
    ){

        return null;

    }

    return await res.json();

}

/* =========================================
   EXPERIENCE
========================================= */

function calculateExperience(data={}){

    const jobs =
        data.experiences || [];

    let total = 0;

    jobs.forEach(job=>{

        total +=
            yearsBetween(

                job.starts_at?.date ||

                job.starts_at ||

                job.start_date

            );

    });

    return total;

}

/* =========================================
   BIG COMPANIES
========================================= */

function countBigCompanies(data={}){

    const jobs =
        data.experiences || [];

    const keywords = [

        "google",

        "meta",

        "microsoft",

        "amazon",

        "binance",

        "coinbase",

        "polygon",

        "consensys",

        "ethereum",

        "solana",

        "ripple",

        "chainlink",

        "aave",

        "optimism",

        "arbitrum"

    ];

    let count = 0;

    jobs.forEach(job=>{

        const company =
            String(

                job.company ||

                ""

            ).toLowerCase();

        if(

            keywords.some(

                k=>company.includes(k)

            )

        ){

            count++;

        }

    });

    return count;

}

/* =========================================
   EDUCATION
========================================= */

function countEducation(data={}){

    return (

        data.education ||

        []

    ).length;

}

/* =========================================
   FOLLOWERS
========================================= */

function followers(data={}){

    return number(

        data.follower_count ||

        data.followers ||

        0

    );

}

/* =========================================
   MAIN
========================================= */

async function fetchProfile(url){

    if(!url){

        return null;

    }

    const profile =
        await request(url);

    if(!profile){

        return {

            linkedin_url:
                url,

            linkedin_score:0

        };

    }

    const experience =
        calculateExperience(profile);

    const companies =
        countBigCompanies(profile);

    const education =
        countEducation(profile);

    const followerCount =
        followers(profile);

    const score =
        calculateScore({

            experience,

            companies,

            education,

            followerCount

        });

    return {

        linkedin_url:

            url,

        full_name:

            profile.full_name ||

            "",

        headline:

            profile.headline ||

            "",

        location:

            profile.city ||

            "",

        followers:

            followerCount,

        total_experience:

            experience,

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

            score

    };

}

/* =========================================
   SCORE
========================================= */

function calculateScore(data={}){

    let score = 0;

    if(

        data.total_experience >= 10

    ){

        score += 30;

    }

    else if(

        data.total_experience >= 5

    ){

        score += 20;

    }

    else if(

        data.total_experience >= 2

    ){

        score += 10;

    }

    if(

        data.big_companies >= 3

    ){

        score += 35;

    }

    else if(

        data.big_companies >= 2

    ){

        score += 25;

    }

    else if(

        data.big_companies >= 1

    ){

        score += 15;

    }

    if(

        data.education_count >= 2

    ){

        score += 10;

    }

    else if(

        data.education_count >= 1

    ){

        score += 5;

    }

    if(

        data.followers >= 10000

    ){

        score += 25;

    }

    else if(

        data.followers >= 3000

    ){

        score += 15;

    }

    else if(

        data.followers >= 1000

    ){

        score += 8;

    }

    if(

        score > 100

    ){

        score = 100;

    }

    return score;

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchProfile,

    calculateExperience,

    calculateScore

};