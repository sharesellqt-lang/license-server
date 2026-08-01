// =========================================
// services/scan/scan.github.js
// =========================================

"use strict";


const githubCollector =
    require("../collectors/github.collector");



/* =========================================
   HELPERS
========================================= */


function normalizeRepository(
    project={}
){

    return (

        project.github ||

        project.github_url ||

        project.repository ||

        project.github_repository ||

        ""

    );

}



/* =========================================
   SCAN GITHUB
========================================= */


async function scanGithub(
    context={}
){


    const project =
        context.project || {};



    const repository =
        normalizeRepository(
            project
        );



    if(!repository){

        return {

            github_repo:"",

            github_score:0,

            message:
                "Github repository missing"

        };

    }



    const data =
        await githubCollector.fetchRepository(
            repository
        );



    if(!data){

        return {

            github_repo:
                repository,

            github_score:
                0,

            message:
                "Github data unavailable"

        };

    }

console.log("========== GITHUB RESULT ==========");
console.log(result);

    return {


        /*
        =============================
           BASIC
        =============================
        */


        github_repo:

            data.github_repo || "",


        github_url:

            data.github_url || "",



        github_language:

            data.github_language || "",



        github_default_branch:

            data.github_default_branch || "",



        /*
        =============================
           ACTIVITY
        =============================
        */


        github_stars:

            data.github_stars || 0,


        github_forks:

            data.github_forks || 0,


        github_watchers:

            data.github_watchers || 0,


        github_open_issues:

            data.github_open_issues || 0,



        github_contributors:

            data.github_contributors || 0,


        github_recent_commits:

            data.github_recent_commits || 0,


        github_releases:

            data.github_releases || 0,



        github_updated_at:

            data.github_updated_at || null,


        github_pushed_at:

            data.github_pushed_at || null,



        /*
        =============================
           SCORE
        =============================
        */


        development_score:

            data.github_score || 0,


        github_score:

            data.github_score || 0


    };


}





/* =========================================
   EXPORT
========================================= */


module.exports = {


    scanGithub


};