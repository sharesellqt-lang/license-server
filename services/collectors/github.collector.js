// =========================================
// services/collectors/github.collector.js
// =========================================

"use strict";

const fetch =
    global.fetch ||
    require("node-fetch");

const BASE_URL =
    "https://api.github.com";

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

function authHeaders(){

    const headers = {

        Accept:
            "application/vnd.github+json",

        "User-Agent":
            "Airdrop-Intelligence"

    };

    if(process.env.GITHUB_TOKEN){

        headers.Authorization =
            `Bearer ${process.env.GITHUB_TOKEN}`;

    }

    return headers;

}

async function request(path){

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

                BASE_URL + path,

                {

                    headers:
                        authHeaders(),

                    signal:
                        controller.signal

                }

            );

        clearTimeout(timeout);

        if(!res.ok){

            console.log(
                "GitHub API:",
                res.status,
                path
            );

            return null;

        }

        return await res.json();

    }

    catch(err){

        console.log(
            "GitHub Error:",
            err.message
        );

        return null;

    }

    finally{

        clearTimeout(timeout);

    }

}

/* =========================================
   PARSE REPOSITORY
========================================= */

function parseRepository(repo){

    if(!repo){

        return null;

    }

    repo =
        String(repo).trim();

    if(repo.startsWith("http")){

        try{

            const url =
                new URL(repo);

            const parts =
                url.pathname
                    .split("/")
                    .filter(Boolean);

            if(parts.length >= 2){

                return {

                    owner:
                        parts[0],

                    repo:
                        parts[1]

                };

            }

        }

        catch(_){

            return null;

        }

    }

    const parts =
        repo.split("/");

    if(parts.length !== 2){

        return null;

    }

    return {

        owner:
            parts[0],

        repo:
            parts[1]

    };

}

/* =========================================
   CONTRIBUTORS
========================================= */

async function fetchContributors(owner,repo){

    const rows =
        await request(

            `/repos/${owner}/${repo}/contributors?per_page=100`

        );

    if(!Array.isArray(rows)){

        return 0;

    }

    return rows.length;

}

/* =========================================
   COMMITS
========================================= */

async function fetchCommits(owner,repo){

    const rows =
        await request(

            `/repos/${owner}/${repo}/commits?per_page=100`

        );

    if(!Array.isArray(rows)){

        return 0;

    }

    return rows.length;

}

/* =========================================
   RELEASES
========================================= */

async function fetchReleases(owner,repo){

    const rows =
        await request(

            `/repos/${owner}/${repo}/releases?per_page=100`

        );

    if(!Array.isArray(rows)){

        return 0;

    }

    return rows.length;

}

/* =========================================
   PROFILE
========================================= */

async function fetchProfile(username){

    if(!username){

        return {

            github_score:0

        };

    }

    username =
        String(username)
            .replace("https://github.com/","")
            .replace("@","")
            .trim();

    const profile =
        await request(
            `/users/${username}`
        );

    if(!profile){

        return {

            github_score:0

        };

    }

    let score = 0;

    if(number(profile.followers)>=100){

        score += 40;

    }
    else if(number(profile.followers)>=30){

        score += 25;

    }
    else if(number(profile.followers)>=10){

        score += 15;

    }

    if(number(profile.public_repos)>=50){

        score += 30;

    }
    else if(number(profile.public_repos)>=20){

        score += 20;

    }
    else if(number(profile.public_repos)>=5){

        score += 10;

    }

    if(profile.company){

        score += 10;

    }

    if(profile.blog){

        score += 5;

    }

    if(score>100){

        score=100;

    }

    return {

        github_username:
            profile.login,

        github_followers:
            number(profile.followers),

        github_public_repos:
            number(profile.public_repos),

        github_score:
            score

    };

}

/* =========================================
   FETCH REPOSITORY
========================================= */

async function fetchRepository(repoInput){

    const parsed =
        parseRepository(repoInput);

    if(!parsed){

        return {};

    }

    const {

        owner,
        repo

    } = parsed;

    const repository =
        await request(

            `/repos/${owner}/${repo}`

        );

    if(!repository){

        return {};

    }

    const [

        contributors,

        commits,

        releases

    ] = await Promise.all([

        fetchContributors(
            owner,
            repo
        ),

        fetchCommits(
            owner,
            repo
        ),

        fetchReleases(
            owner,
            repo
        )

    ]);

    const result = {

        github_repo:

            repository.full_name ||

            `${owner}/${repo}`,

        github_url:

            repository.html_url ||

            "",

        github_stars:

            number(
                repository.stargazers_count
            ),

        github_forks:

            number(
                repository.forks_count
            ),

        github_watchers:

            number(
                repository.subscribers_count
            ),

        github_open_issues:

            number(
                repository.open_issues_count
            ),

        github_size:

            number(
                repository.size
            ),

        github_default_branch:

            repository.default_branch ||

            "",

        github_language:

            repository.language ||

            "",

        github_created_at:

            repository.created_at ||

            null,

        github_updated_at:

            repository.updated_at ||

            null,

        github_pushed_at:

            repository.pushed_at ||

            null,

        github_archived:

            !!repository.archived,

        github_disabled:

            !!repository.disabled,

        github_private:

            !!repository.private,

        github_contributors:

            contributors,

        github_recent_commits:

            commits,

        github_releases:

            releases

    };

    result.github_score =
        calculateGithubScore({

            stars:
                result.github_stars,

            forks:
                result.github_forks,

            contributors,

            commits,

            releases,

            updated:
                result.github_pushed_at

        });

    console.table({

        repo:
            result.github_repo,

        stars:
            result.github_stars,

        forks:
            result.github_forks,

        contributors:
            contributors,

        commits:
            commits,

        score:
            result.github_score

    });

    return result;

}

/* =========================================
   SCORE
========================================= */

function calculateGithubScore(d={}){

    let score = 0;

    const stars =
        number(d.stars);

    if(stars>=1000){

        score+=25;

    }
    else if(stars>=300){

        score+=18;

    }
    else if(stars>=100){

        score+=12;

    }

    const forks =
        number(d.forks);

    if(forks>=100){

        score+=10;

    }
    else if(forks>=20){

        score+=6;

    }

    const contributors =
        number(d.contributors);

    if(contributors>=20){

        score+=20;

    }
    else if(contributors>=10){

        score+=15;

    }
    else if(contributors>=5){

        score+=10;

    }

    const commits =
        number(d.commits);

    if(commits>=50){

        score+=20;

    }
    else if(commits>=20){

        score+=15;

    }
    else if(commits>=5){

        score+=8;

    }

    const releases =
        number(d.releases);

    if(releases>=5){

        score+=10;

    }

    if(d.updated){

        const pushed =
            new Date(d.updated);

        if(!Number.isNaN(pushed.getTime())){

            const days =

                (

                    Date.now() -

                    pushed.getTime()

                ) /

                86400000;

            if(days<=30){

                score+=15;

            }
            else if(days<=90){

                score+=8;

            }

        }

    }

    return Math.min(score,100);

}

/* =========================================
   EXPORTS
========================================= */

module.exports = {

    fetchRepository,

    fetchProfile,

    calculateGithubScore,

    parseRepository

};