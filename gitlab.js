/**
 * @typedef {import("./types/gitlab.d.ts").GitLabIssue} GitLabIssue
 * @typedef {import("./types/gitlab.d.ts").GitLabLabel} GitLabLabel
 * @typedef {import("./types/gitlab.d.ts").GitLabMilestone} GitLabMilestone
 * @typedef {import("./types/notion.d.ts").NotionPage} NotionPage
 */

const PROJECT_ID = process.env.GITLAB_PROJECT_ID;
const GITLAB_DOMAIN = process.env.GITLAB_DOMAIN;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

const { default: fetch } = require("node-fetch");

/**
 * Gets issues from a GitLab repository. Pull requests are omitted.
 *
 * https://docs.gitlab.com/ee/api/rest/#keyset-based-pagination
 * https://docs.gitlab.com/ee/api/issues.html#list-project-issues
 *
 * @returns {Promise<Array<GitLabIssue>>}
 */
async function getGitLabIssuesForRepository() {
  /** @type {GitLabIssue[]} */
  const issues = [];

  let page = 1;
  let pageSize = 100;
  let lastPageSize = -1;

  do {
    let response = await fetch(
      `https://${GITLAB_DOMAIN}/api/v4/projects/${PROJECT_ID}/issues?scope=all&pagination=keyset&sort=asc&page=${page}&per_page=${pageSize}`,
      {
        headers: {
          "PRIVATE-TOKEN": GITLAB_TOKEN,
        },
      }
    );
    let data = await response.json();
    // Filter out only issues assigned to "Jan Strich"
    let filteredData = data.filter(issue =>
      issue.assignees.some(assignee => assignee.name === "Jan Strich")
    );
    issues.push(...filteredData);

    lastPageSize = data.length;
    page++;

    // Check if the received page was full
  } while (lastPageSize == pageSize);

  return issues;
}

/**
 * Gets labels from the GitLab project
 *
 * https://docs.gitlab.com/ee/api/labels.html
 *
 * @returns {Promise<GitLabLabel>}
 */
async function getGitLabLabelsForProject() {
  let response = await fetch(
    `https://${GITLAB_DOMAIN}/api/v4/projects/${PROJECT_ID}/labels`,
    {
      headers: {
        "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
      },
    }
  );

  return await response.json();
}

/**
 * Gets milestones from the GitLab project
 *
 * https://docs.gitlab.com/ee/api/milestones.html
 *
 * @returns {Promise<GitLabMilestone>}
 */
async function getGitLabMilestonesForProject() {
  let response = await fetch(
    `https://${GITLAB_DOMAIN}/api/v4/projects/${PROJECT_ID}/milestones`,
    {
      headers: {
        "PRIVATE-TOKEN": GITLAB_TOKEN,
      },
    }
  );

  return await response.json();
}

//*========================================================================
// Helpers
//*========================================================================

/**
 * Returns the GitLab issue to conform to this database's schema properties.
 *
 * @param {GitLabIssue} issue
 */
function getPropertiesFromIssue(issue) {
  let props = {
    id: {
      rich_text: [
        {
          type: "text",
          text: {
            content: "#" + issue.iid,
            // Make the issue ID tag clickable
            link: {
              url: issue.web_url,
            },
          },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: "default",
          },
          plain_text: "#" + issue.iid,
          href: issue.web_url,
        },
      ],
    },
    open: {
      type: "checkbox",
      checkbox: issue.state == "opened",
    },
    title: {
      title: [{ type: "text", text: { content: "G4KMU: " + issue.title } }],
    },
    notes: {
      rich_text: [
        {
          type: "text",
          text: {
            content: issue.description,
            link: null,
          },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: "default",
          },
        },
      ],
    },

    assignees: {
      rich_text: [
        {
          type: "text",
          text: {
            content: issue.assignees.map(a => a.name).join(", "),
            link: null,
          },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: "default",
          },
        },
      ],
    },
    last_updated_at: {
      date: {
        start: issue.updated_at,
      },
    },
    type_of_work: {
      multi_select: [{ name: "Programming" }],
    },
    tags: {
      multi_select: issue.labels.map(l => ({ name: l })),
    },
  };

  return props;
}

module.exports = {
  getGitLabIssuesForRepository,
  getGitLabLabelsForProject,
  getPropertiesFromIssue,
  getGitLabMilestonesForProject,
};
