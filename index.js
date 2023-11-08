/* 

This code is based on the github-sync example of the @notionhq/client package.

https://github.com/makenotion/notion-sdk-js/blob/ba873383d5416405798c66d0b47fed3717c14f6a/examples/notion-github-sync/index.js

*/

/**
 * @typedef {import("./types/gitlab.d.ts").GitLabIssue} GitLabIssue
 * @typedef {import("./types/notion.d.ts").NotionPage} NotionPage
 */

const { Client } = require("@notionhq/client");
const dotenv = require("dotenv");
const _ = require("lodash");
const {
  getGitLabIssuesForRepository,
  getGitLabLabelsForProject,
  getPropertiesFromIssue,
} = require("./gitlab.js");

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_KEY });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const OPERATION_BATCH_SIZE = 10;

/**
 * Local map to store  GitLab issue ID to its Notion pageId.
 * @type { [issueId: string]: string }
 */
const gitLabIssuesIdToNotionPageId = {};

/**
 * Initialize local data store.
 * Then sync with GitLab.
 */
setInitialGitLabToNotionIdMap().then(syncNotionDatabaseWithGitLab);

/**
 * Get and set the initial data store with issues currently in the database.
 */
async function setInitialGitLabToNotionIdMap() {
  const currentIssues = await getIssuesFromNotionDatabase();
  for (const { pageId, issueNumber } of currentIssues) {
    gitLabIssuesIdToNotionPageId[issueNumber] = pageId;
  }
}

async function syncNotionDatabaseWithGitLab() {
  // Get all issues currently in the provided GitLab repository.
  console.log("\nFetching issues from GitLab repository...");
  const issues = await getGitLabIssuesForRepository();
  console.log(`Fetched ${issues.length} issues from GitLab repository.`);

  // Get all labels used in the GitLab projct
  const labels = await getGitLabLabelsForProject();
  console.log(`Fetched ${labels.length} lables from GitLab project.`);

  // Update all the label options to reflect the projects tag
  await updateMultiSelectOptions(labels);

  // Group issues into those that need to be created or updated in the Notion database.
  const { pagesToCreate, pagesToUpdate } = getNotionOperations(issues);

  // Create pages for new issues.
  console.log(`\n${pagesToCreate.length} new issues to add to Notion.`);
  await createPages(pagesToCreate);

  // Updates pages for existing issues.
  console.log(`\n${pagesToUpdate.length} issues to update in Notion.`);
  await updatePages(pagesToUpdate);

  // Success!
  console.log("\n✅ Notion database is synced with GitLab.");
}

/**
 * Gets pages from the Notion database.
 *
 * @returns {Promise<Array<{ pageId: string, issueNumber: number }>>}
 */
async function getIssuesFromNotionDatabase() {
  /** @type {NotionPage[]} */
  const pages = [];
  let cursor = undefined;

  let db = await notion.databases.retrieve({
    database_id: DATABASE_ID,
  });

  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
    });
    pages.push(...results);
    if (!next_cursor) {
      break;
    }
    cursor = next_cursor;
  }
  console.log(`${pages.length} issues successfully fetched from Notion.`);

  const issues = [];
  for (const page of pages) {
    const issueNumberPropertyId = page.properties["id"].id;
    /*
    const propertyResult = await notion.pages.properties.retrieve({
      page_id: page.id,
      property_id: issueNumberPropertyId,
    });
    */
    try {
      issues.push({
        pageId: page.id,
        issueNumber: page.properties.id.rich_text[0].plain_text.slice(1),
      });
    } catch (e) {
      console.log("oops");
    }
  }

  return issues;
}

/**
 * Determines which issues already exist in the Notion database.
 *
 * @param {Array<GitLabIssue>} issues
 * @returns {{
 *   pagesToCreate: Array<{ number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>;
 *   pagesToUpdate: Array<{ pageId: string, number: number, title: string, state: "open" | "closed", comment_count: number, url: string }>
 * }}
 */
function getNotionOperations(issues) {
  const pagesToCreate = [];
  const pagesToUpdate = [];
  for (const issue of issues) {
    const pageId = gitLabIssuesIdToNotionPageId[issue.iid];
    if (pageId) {
      pagesToUpdate.push({
        ...issue,
        pageId,
      });
    } else {
      pagesToCreate.push(issue);
    }
  }
  return { pagesToCreate, pagesToUpdate };
}

/**
 * Creates new pages in Notion.
 *
 * https://developers.notion.com/reference/post-page
 *
 * @param {Array < { number: number, title: string, state: "open" | "closed", comment_count: number, url: string } >} pagesToCreate
 */
async function createPages(pagesToCreate) {
  const pagesToCreateChunks = _.chunk(pagesToCreate, OPERATION_BATCH_SIZE);
  for (const pagesToCreateBatch of pagesToCreateChunks) {
    await Promise.all(
      pagesToCreateBatch.map(issue =>
        notion.pages.create({
          parent: { database_id: DATABASE_ID },
          properties: getPropertiesFromIssue(issue),
        })
      )
    );
    console.log(`Completed batch size: ${pagesToCreateBatch.length}`);
  }
}

/**
 * Updates provided pages in Notion.
 *
 * https://developers.notion.com/reference/patch-page
 *
 * @param {Array < { pageId: string, number: number, title: string, state: "open" | "closed", comment_count: number, url: string } >} pagesToUpdate
 */
async function updatePages(pagesToUpdate) {
  const pagesToUpdateChunks = _.chunk(pagesToUpdate, OPERATION_BATCH_SIZE);
  for (const pagesToUpdateBatch of pagesToUpdateChunks) {
    await Promise.all(
      pagesToUpdateBatch.map(({ pageId, ...issue }) =>
        notion.pages.update({
          page_id: pageId,
          properties: getPropertiesFromIssue(issue),
        })
      )
    );
    console.log(`Completed batch size: ${pagesToUpdateBatch.length}`);
  }
}

const availableColors = [
  "blue",
  "brown",
  "default",
  "gray",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "yellow",
];
/**
 * Updates provided pages in Notion.
 *
 * https://developers.notion.com/reference/patch-page
 *
 * @param {Array < { name: string, color: string } >} labels
 */
async function updateMultiSelectOptions(labels) {
  await notion.databases.update({
    database_id: DATABASE_ID,
    properties: {
      tags: {
        multi_select: {
          options: labels.map((l, i) => ({
            name: l.name,
            color: availableColors[i % availableColors.length],
          })),
        },
      },
    },
  });
}

/*
  db.properties.tags
  {
  id: "WFl%3F",
  name: "tags",
  type: "multi_select",
  multi_select: {
    options: [
      {
        id: "sysU",
        name: "c",
        color: "gray",
      },
      {
        id: "k@BI",
        name: "b",
        color: "pink",
      },
      {
        id: "fmab",
        name: "a",
        color: "red",
      },
    ],
  },
}
  */
