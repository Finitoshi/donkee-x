const express = require('express');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
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

/**
 * Generates content using Grok AI and sends a tweet
 */
async function generateContentAndTweet() {
  try {
    // Prepare the prompt for Grok
    const payload = {
      "messages": [
        {
          "role": "system",
          "content": "You are DONKEE, a highly intelligent, edgy, weed-smoking donkey who loves Solana memecoins and degen trading. Your tweets should be witty, playful, and target Gen Z and Millennials. Avoid direct financial advice or promotions."
        },
        {
          "role": "user",
          "content": "Generate a tweet for me."
        }
      ],
      "model": "grok-2-latest",
      "stream": false,
      "temperature": 0.7
    };

    // API call to Grok for text generation with increased timeout
    const response = await axios.post('https://api.x.ai/v1/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      timeout: 180000 // 3 minutes timeout for API calls
    });

    // Extract the generated text from the response
    const generatedText = response.data.choices[0].message.content;
    console.log('Generated Text:', generatedText);

    // Post the tweet
    await twitterClient.v2.tweet(generatedText + " #ForEntertainmentOnly #NotFinancialAdvice");
    console.log('Tweet sent successfully!');
  } catch (error) {
    console.error('Error in content generation or tweeting:', error);
    // Log error to file for persistent storage
    fs.appendFile('error.log', `Error: ${JSON.stringify(error)}\n`, (err) => {
      if (err) console.error('Error logging:', err);
    });
  }
}

// Endpoint to trigger the bot with API key validation
app.get('/', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.DONKEE_SECRET_KEY) {
    return res.status(401).send('Unauthorized');
  }
  try {
    await generateContentAndTweet();
    res.status(200).send('OK'); // Minimal response
  } catch (error) {
    console.error('Cron job failed:', error);
    res.status(500).send('Error');
  }
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  server.setTimeout(180000); // 3 minutes server timeout
});
