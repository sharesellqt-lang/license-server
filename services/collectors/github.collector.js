"use strict";

/* =========================================
   GITHUB COLLECTOR
========================================= */

const fetch =
    global.fetch ||
    require("node-fetch");

const API =
    "https://api.github.com";

/* =========================================
   HELPERS
========================================= */

function number(value) {

    value = Number(value);

    if (!Number.isFinite(value)) {

        return 0;

    }

    return value;

}

function authHeaders() {

    const headers = {

        Accept:
            "application/vnd.github+json",

        "User-Agent":
            "Airdrop-Intelligence"

    };

    if (process.env.GITHUB_TOKEN) {

        headers.Authorization =
            `Bearer ${process.env.GITHUB_TOKEN}`;

    }

    return headers;

}

async function request(path) {

    const res =
        await fetch(

            API + path,

            {

                headers:
                    authHeaders()

            }

        );

    if (!res.ok) {

        throw new Error(

            `GitHub ${res.status}`

        );

    }

    return await res.json();

}

/* =========================================
   PARSE URL
========================================= */

function parseRepository(repo) {

    if (!repo) {

        return null;

    }

    repo =
        repo.trim();

    if (

        repo.startsWith("http")

    ) {

        try {

            const url =
                new URL(repo);

            const parts =
                url.pathname
                .split("/")
                .filter(Boolean);

            if (parts.length >= 2) {

                return {

                    owner:
                        parts[0],

                    repo:
                        parts[1]

                };

            }

        }

        catch (_) {

            return null;

        }

    }

    const parts =
        repo.split("/");

    if (parts.length !== 2) {

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

async function fetchContributors(

    owner,

    repo

) {

    try {

        const rows =
            await request(

                `/repos/${owner}/${repo}/contributors?per_page=100`

            );

        return rows.length;

    }

    catch (_) {

        return 0;

    }

}

/* =========================================
   COMMITS
========================================= */

async function fetchCommits(

    owner,

    repo

) {

    try {

        const rows =
            await request(

                `/repos/${owner}/${repo}/commits?per_page=100`

            );

        return rows.length;

    }

    catch (_) {

        return 0;

    }

}

/* =========================================
   RELEASES
========================================= */

async function fetchReleases(

    owner,

    repo

) {

    try {

        const rows =
            await request(

                `/repos/${owner}/${repo}/releases?per_page=100`

            );

        return rows.length;

    }

    catch (_) {

        return 0;

    }

}

/* =========================================
   MAIN
========================================= */

async function fetchRepository(repoInput) {

    const parsed =
        parseRepository(
            repoInput
        );

    if (!parsed) {

        return null;

    }

    const {

        owner,

        repo

    } = parsed;

    const repository =
        await request(

            `/repos/${owner}/${repo}`

        );

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

    return {

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

            releases,

        github_score:

            calculateGithubScore({

                stars:
                    repository.stargazers_count,

                forks:
                    repository.forks_count,

                contributors,

                commits,

                releases,

                updated:
                    repository.pushed_at

            })

    };

}

/* =========================================
   SCORE
========================================= */

function calculateGithubScore(d) {

    let score = 0;

    if (

        number(d.stars) >= 1000

    ) {

        score += 25;

    }

    else if (

        number(d.stars) >= 300

    ) {

        score += 18;

    }

    else if (

        number(d.stars) >= 100

    ) {

        score += 12;

    }

    if (

        number(d.forks) >= 100

    ) {

        score += 10;

    }

    else if (

        number(d.forks) >= 20

    ) {

        score += 6;

    }

    if (

        number(d.contributors) >= 20

    ) {

        score += 20;

    }

    else if (

        number(d.contributors) >= 10

    ) {

        score += 15;

    }

    else if (

        number(d.contributors) >= 5

    ) {

        score += 10;

    }

    if (

        number(d.commits) >= 50

    ) {

        score += 20;

    }

    else if (

        number(d.commits) >= 20

    ) {

        score += 15;

    }

    else if (

        number(d.commits) >= 5

    ) {

        score += 8;

    }

    if (

        number(d.releases) >= 5

    ) {

        score += 10;

    }

    const pushed =
        new Date(
            d.updated
        );

    const days =
        (

            Date.now() -

            pushed.getTime()

        ) /

        86400000;

    if (

        days <= 30

    ) {

        score += 15;

    }

    else if (

        days <= 90

    ) {

        score += 8;

    }

    if (

        score > 100

    ) {

        score = 100;

    }

    return score;

}

/* =========================================
   EXPORT
========================================= */

module.exports = {

    fetchRepository,

    calculateGithubScore,

    parseRepository

};