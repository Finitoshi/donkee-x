// Test script (testSearch.js)
import { searchTweets } from './searchService.js';

async function testSearch() {
  console.log('Testing memecoin search:');
  const results = await searchTweets('memecoin');
  console.log(results.slice(0, 2));
}

testSearch();
