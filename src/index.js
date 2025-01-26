const express = require('express');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const rateLimit = require('express-rate-limit');
const { MongoClient } = require('mongodb');
const app = express();

// Initialize Twitter client using environment variables for security
const twitterClient = new TwitterApi({
  appKey: process.env.APP_KEY,
  appSecret: process.env.APP_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: "Too many requests from this IP, please try again later."
});
app.use(limiter);

// MongoDB connection using environment variable
const url = process.env.MONGODB_URL;
const dbName = 'donkeeBot';
let db;

// Connect to MongoDB
MongoClient.connect(url, { useUnifiedTopology: true }, function(err, client) {
  if(err) {
    console.log('Error connecting to MongoDB:', err);
  } else {
    console.log('Connected successfully to MongoDB server');
    db = client.db(dbName);
    setupTweetCollection();
  }
});

// Function to setup the collection with appropriate indexes
function setupTweetCollection() {
  const collection = db.collection('tweets');
  
  // Index for efficient querying by timestamp
  collection.createIndex({ "timestamp": 1 }, { background: true });
  
  // Index for querying by hashtags
  collection.createIndex({ "hashtags": 1 }, { background: true });
  
  // Index for engagement metrics if you frequently query by these
  collection.createIndex({ "likes": -1, "retweets": -1 }, { background: true });
}

/**
 * Store tweets in MongoDB with the new structure
 */
async function storeTweet(tweet) {
  if (!db) return;
  const collection = db.collection('tweets');
  
  const tweetData = {
    tweet_id: tweet.id,
    text: tweet.text,
    likes: tweet.public_metrics.like_count,
    retweets: tweet.public_metrics.retweet_count,
    timestamp: new Date(tweet.created_at),
    hashtags: tweet.entities && tweet.entities.hashtags ? tweet.entities.hashtags.map(h => h.tag) : []
  };

  try {
    await collection.insertOne(tweetData);
    console.log('Tweet stored in MongoDB:', tweet.id);
  } catch (error) {
    console.error('Error storing tweet:', error);
  }
}

/**
 * Search for tweets and store them in MongoDB
 */
async function searchAndStoreTweets() {
  try {
    const tweets = await twitterClient.v2.search('#SolanaMemeCoins OR #SolanaNewCoin lang:en -is:retweet', { max_results: 10 });
    for (const tweet of tweets.data) {
      await storeTweet(tweet);
    }
    console.log('Tweets stored in MongoDB.');
  } catch (error) {
    console.error('Error searching for tweets:', error);
  }
}

/**
 * Find the highest engagement tweet from MongoDB
 */
async function findHighestEngagementTweet() {
  if (!db) return null;
  const collection = db.collection('tweets');
  return collection.findOne({}, { sort: { likes: -1, retweets: -1 } });
}

/**
 * Use Grok AI to generate a comment
 */
async function generateCommentWithGrok(tweetText) {
  const payload = {
    "messages": [
      {
        "role": "system",
        "content": "You are DONKEE, a highly intelligent, edgy, weed-smoking donkey who loves Solana memecoins and degen trading. Your tweets should be witty, playful, and target Gen Z and Millennials. Avoid direct financial advice or promotions."
      },
      {
        "role": "user",
        "content": `Comment on this tweet: "${tweetText}". Keep it playful and avoid financial advice.`
      }
    ],
    "model": "grok-2-latest",
    "stream": false,
    "temperature": 0.7
  };

  try {
    const response = await axios.post('https://api.x.ai/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      timeout: 180000 // 3 minutes timeout for API calls
    });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error generating comment with Grok:', error);
    return "Oops, Donkee's too high to comment right now!";
  }
}

/**
 * Generate and post comment on the best tweet from the last 8 hours
 */
async function generateAndPostComment() {
  const tweet = await findHighestEngagementTweet();
  if (tweet) {
    const comment = await generateCommentWithGrok(tweet.text);
    console.log('Generated Comment:', comment);

    // Post the reply
    try {
      await twitterClient.v2.reply(comment, tweet.tweet_id);
      console.log('Reply sent successfully!');
    } catch (error) {
      console.error('Error posting reply:', error);
    }
  } else {
    console.log('No tweet found to comment on.');
  }
}

// Endpoint to trigger the bot with API key validation
app.get('/', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.DONKEE_SECRET_KEY) {
    return res.status(401).send('Unauthorized');
  }
  
  try {
    const now = new Date();
    const minutes = now.getMinutes();
    const hours = now.getHours();

    if (minutes === 0 && hours % 2 === 0) { // Store tweets every 2 hours
      await searchAndStoreTweets();
    } else if (minutes === 0 && hours % 8 === 0) { // Comment every 8 hours
      await generateAndPostComment();
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Cron job failed:', error);
    res.status(500).send('Error');
  }
});

// Health check endpoint for waking up the server
app.get('/health', (req, res) => {
  res.status(200).send('Healthy');
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  server.setTimeout(180000); // 3 minutes server timeout
});
