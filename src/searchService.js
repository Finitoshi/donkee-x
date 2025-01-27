import { connectDB } from './db.js';

// 1. Basic Tweet Search
export async function searchTweets(query, options = {}) {
  const db = await connectDB();
  return db.collection('postedTweets').aggregate([
    {
      $search: {
        index: 'tweet_search',
        text: {
          query: query,
          path: 'text',
          fuzzy: options.fuzzy || { maxEdits: 1 }
        }
      }
    },
    { $sort: options.sort || { likes: -1 } },
    { $limit: options.limit || 10 }
  ]).toArray();
}

// 2. Hashtag Analytics
export async function analyzeHashtag(hashtag) {
  const db = await connectDB();
  return db.collection('postedTweets').aggregate([
    {
      $search: {
        index: 'tweet_search',
        phrase: {
          query: `#${hashtag}`,
          path: "hashtags"
        }
      }
    },
    { 
      $group: {
        _id: "$hashtags",
        totalEngagement: { 
          $sum: { $add: ["$likes", "$retweets"] } 
        },
        avgSentiment: { $avg: "$sentimentScore" }
      }
    }
  ]).toArray();
}

// 3. Contextual Reply Generator
export async function findSimilarTweets(text) {
  const db = await connectDB();
  return db.collection('postedTweets').aggregate([
    {
      $search: {
        index: 'tweet_search',
        moreLikeThis: {
          like: { text: text }
        }
      }
    },
    { $limit: 5 },
    { 
      $project: {
        _id: 0,
        text: 1,
        engagementScore: { 
          $add: ["$likes", { $multiply: ["$retweets", 2] }] 
        }
      }
    }
  ]).toArray();
}
