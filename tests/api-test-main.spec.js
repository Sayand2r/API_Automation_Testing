const { test, expect } = require('@playwright/test');
const fs = require('fs');
const csv = require('csv-parser');
const ReportGeneratorClient = require('../report-generator-client');

// Helper function to add delay between API requests
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Array of realistic User-Agent strings to rotate through
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
];

// Generate variable request headers to avoid detection
function generateVariableHeaders(queryIndex) {
  const userAgent = USER_AGENTS[queryIndex % USER_AGENTS.length];
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const baseHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'User-Agent': userAgent,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Session-ID': sessionId
  };
  
  // Add some variable optional headers
  if (Math.random() > 0.5) {
    baseHeaders['Accept-Encoding'] = 'gzip, deflate, br';
  }
  
  if (Math.random() > 0.6) {
    baseHeaders['Connection'] = 'keep-alive';
  }
  
  if (Math.random() > 0.7) {
    baseHeaders['DNT'] = '1';
  }
  
  return baseHeaders;
}

// Helper function to make API request with retry logic
async function makeAPIRequestWithRetry(request, apiBaseUrl, query, maxRetries = 3, queryIndex = 0, page = 1) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`   🔄 Attempt ${attempt}/${maxRetries} for query: "${query}" (Page ${page})`);
      
      // Add wider random delay to prevent synchronized requests (2-10 seconds)
      const baseDelay = 2000 + (attempt - 1) * 1000; // Progressive: 2s, 3s, 4s
      const randomDelay = baseDelay + Math.floor(Math.random() * 6000); // +0-6s random
      console.log(`   ⏳ Waiting ${(baseDelay + randomDelay)/1000}s before attempt ${attempt}...`);
      await delay(randomDelay);
      
      // Generate variable headers for this attempt
      const headers = generateVariableHeaders(queryIndex + attempt);
      
      // Generate variable parameters to avoid caching
      const params = {
        siteId: 'os7898',
        q: query,
        page: page.toString(),
        resultsPerPage: '24',
        use_cache: 'false',
        timestamp: Date.now(),
        r: Math.random().toString(36).substr(2, 8) // Random cache buster
      };
      
      // Progressive timeout increase
      const timeout = 45000 + (attempt - 1) * 15000; // 45s, 60s, 75s
      
      const response = await request.get(`${apiBaseUrl}/api/v1/search.json`, {
        params,
        headers,
        timeout
      });
      
      if (response.status() === 200) {
        const data = await response.json();
        // CRITICAL FIX: Treat empty results as a failure that should be retried
        if (data.results && data.results.length > 0) {
          console.log(`   ✅ Success on attempt ${attempt}: ${data.results.length} products found`);
          return { response, data };
        } else {
          console.log(`   ⚠️ Attempt ${attempt}: API returned 200 but ZERO products - likely rate limited`);
          if (attempt === maxRetries) {
            // On final attempt, throw error instead of returning empty results
            throw new Error(`API consistently returning 0 products for query "${query}" - possible rate limiting`);
          }
          // Continue to next attempt instead of returning empty results
        }
      } else {
        console.log(`   ❌ Attempt ${attempt}: HTTP ${response.status()}`);
        if (attempt === maxRetries) {
          throw new Error(`API returned HTTP ${response.status()} after ${maxRetries} attempts`);
        }
      }
      
    } catch (error) {
      console.log(`   ❌ Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt === maxRetries) {
        throw error; // Throw error only on final attempt
      }
      
      // Progressive backoff delay (5, 10, 15 seconds)
      const backoffDelay = attempt * 5000;
      console.log(`   ⏳ Waiting ${backoffDelay/1000} seconds before retry...`);
      await delay(backoffDelay);
    }
  }
  
  // Should never reach here, but just in case
  throw new Error(`Failed to get valid response after ${maxRetries} attempts for query: "${query}"`);
}


// Helper function to check if a product is related to the query
function isProductRelated(product, query) {
  const searchTerm = query.toLowerCase();
  const fieldsToCheck = [
    product.name,
    product.description,
    product.brand,
    product.category
  ].filter(Boolean).join(' ').toLowerCase();
  
  return fieldsToCheck.includes(searchTerm);
}

// // Helper function to determine word position in text
// function getWordPosition(text, searchWord) {
//   if (!text || !searchWord) return null;
  
//   const lowerText = text.toLowerCase();
//   const lowerWord = searchWord.toLowerCase();
//   const wordIndex = lowerText.indexOf(lowerWord);
  
//   if (wordIndex === -1) return null;
  
//   // Check if word appears at the beginning (first 20% of text)
//   if (wordIndex === 0 || wordIndex / text.length < 0.2) {
//     return 'beginning';
//   }
  
//   // Check if word appears at the end (last 20% of text)
//   if ((wordIndex + searchWord.length) >= text.length || 
//       wordIndex / text.length > 0.8) {
//     return 'end';
//   }
  
//   // Otherwise it's in the middle
//   return 'middle';
// }

// // Function to analyze word positions in product descriptions
// function analyzeWordPositions(products, searchQuery) {
//   const stats = {
//     beginning: 0,
//     middle: 0,
//     end: 0,
//     notFound: 0,
//     details: []
//   };
  
//   const searchWords = searchQuery.toLowerCase().split(/\s+/);
  
//   products.forEach((product, index) => {
//     const description = product.description || product.name || '';
//     let foundPosition = null;
    
//     // Check each word from the search query
//     for (const word of searchWords) {
//       const position = getWordPosition(description, word);
//       if (position) {
//         foundPosition = position;
//         stats[position]++;
//         stats.details.push({
//           productIndex: index,
//           productName: product.name,
//           sku: product.sku,
//           word: word,
//           position: position,
//           description: description.substring(0, 100) + (description.length > 100 ? '...' : '')
//         });
//         break; // Count only the first matching word
//       }
//     }
    
//     if (!foundPosition) {
//       stats.notFound++;
//     }
//   });
  
//   return stats;
// }

// Function to search for expected products across multiple pages
async function searchAcrossPages(request, apiBaseUrl, query, expectedProducts, maxPages = 5, queryIndex = 0) {
  const allProducts = [];
  let totalResults = 0;
  let currentPage = 1;
  let foundAllExpected = false;
  
  console.log(`\n🔍 Starting multi-page search (up to ${maxPages} pages) for ${expectedProducts.length} expected products...`);
  
  while (currentPage <= maxPages && !foundAllExpected) {
    try {
      // Make API request for current page
      const { response, data: responseData } = await makeAPIRequestWithRetry(
        request, 
        apiBaseUrl, 
        query,
        3, // maxRetries
        queryIndex,
        currentPage // page number
      );
      
      if (responseData.results && responseData.results.length > 0) {
        // Add page number to each product for tracking
        const productsWithPage = responseData.results.map((product, index) => ({
          ...product,
          pageNumber: currentPage,
          absolutePosition: (currentPage - 1) * 24 + index + 1
        }));
        
        allProducts.push(...productsWithPage);
        
        // Update total results from first page response
        if (currentPage === 1 && responseData.pagination) {
          totalResults = responseData.pagination.totalResults || responseData.results.length;
        }
        
        // Check if we've found all expected products
        const foundCount = expectedProducts.filter(expected => 
          allProducts.some(actual => 
            actual.sku && expected.expectedSku && 
            actual.sku.toLowerCase() === expected.expectedSku.toLowerCase()
          )
        ).length;
        
        console.log(`   📄 Page ${currentPage}: Found ${responseData.results.length} products (${foundCount}/${expectedProducts.length} expected products found so far)`);
        
        if (foundCount === expectedProducts.length) {
          foundAllExpected = true;
          console.log(`   ✅ All expected products found by page ${currentPage}`);
        } else if (currentPage < maxPages) {
          console.log(`   ⏭️  Not all expected products found, checking page ${currentPage + 1}...`);
          await delay(3000); // Delay between page requests
        }
        
        currentPage++;
      } else {
        // No more results, stop searching
        console.log(`   📭 No products returned on page ${currentPage}, stopping search`);
        break;
      }
    } catch (error) {
      console.log(`   ❌ Error fetching page ${currentPage}: ${error.message}`);
      break;
    }
  }
  
  if (!foundAllExpected && currentPage > maxPages) {
    console.log(`   ⚠️  Reached maximum page limit (${maxPages}), some expected products may not be found`);
  }
  
  return {
    allProducts,
    totalResults,
    pagesSearched: Math.min(currentPage - 1, maxPages)
  };
}

// Function to count expected products found on first page (first 24 products)
function countExpectedProductsOnFirstPage(expectedProducts, actualProducts) {
  if (!expectedProducts || expectedProducts.length === 0) {
    return null;
  }
  
  if (!actualProducts || actualProducts.length === 0) {
    return {
      foundOnFirstPage: 0,
      totalExpected: expectedProducts.length,
      foundProducts: []
    };
  }
  
  // Consider first page as first 24 products
  const firstPageProducts = actualProducts.slice(0, 24);
  const foundProducts = [];
  let foundCount = 0;
  
  expectedProducts.forEach(expected => {
    // Check if this expected product exists on first page by SKU match
    const foundOnFirstPage = firstPageProducts.find(actual => 
      actual.sku && expected.expectedSku && 
      actual.sku.toLowerCase() === expected.expectedSku.toLowerCase()
    );
    
    if (foundOnFirstPage) {
      foundCount++;
      foundProducts.push({
        expectedName: expected.expectedName,
        expectedSku: expected.expectedSku,
        actualPosition: firstPageProducts.indexOf(foundOnFirstPage) + 1
      });
    }
  });
  
  return {
    foundOnFirstPage: foundCount,
    totalExpected: expectedProducts.length,
    foundProducts: foundProducts
  };
}

// Function to find actual positions of all expected products
function findAllProductPositions(expectedProducts, actualProducts) {
  const positionMapping = [];
  
  if (!expectedProducts || expectedProducts.length === 0) {
    return positionMapping;
  }
  
  if (!actualProducts || actualProducts.length === 0) {
    // If no actual products, mark all expected as not found
    expectedProducts.forEach(exp => {
      positionMapping.push({
        expectedName: exp.expectedName,
        expectedSku: exp.expectedSku,
        expectedPosition: exp.expectedPosition,
        actualPosition: null,
        status: 'Not Found',
        actualProduct: null
      });
    });
    return positionMapping;
  }
  
  // Check each expected product
  expectedProducts.forEach(exp => {
    const foundIndex = actualProducts.findIndex(p => p.sku === exp.expectedSku);
    
    if (foundIndex !== -1) {
      const foundProduct = actualProducts[foundIndex];
      const actualPosition = foundProduct.absolutePosition || (foundIndex + 1);
      const pageNumber = foundProduct.pageNumber || 1;
      positionMapping.push({
        expectedName: exp.expectedName,
        expectedSku: exp.expectedSku,
        expectedPosition: exp.expectedPosition,
        actualPosition: actualPosition,
        pageNumber: pageNumber,
        status: actualPosition === exp.expectedPosition ? 'Exact Match' : `Found at Position ${actualPosition}`,
        actualProduct: foundProduct
      });
    } else {
      positionMapping.push({
        expectedName: exp.expectedName,
        expectedSku: exp.expectedSku,
        expectedPosition: exp.expectedPosition,
        actualPosition: null,
        pageNumber: null,
        status: 'Not Found',
        actualProduct: null
      });
    }
  });
  
  return positionMapping;
}


// Helper function to convert results to CSV
function generateCSV(results) {
  const headers = [
    'Input Query',
    'Input Expected Name',
    'Actual Product Name',
    'Input Expected SKU',
    'Actual SKU',
    'Input Expected Position',
    'Actual Position',
    'Position Match',
    'First Page Count',
    'First Page Coverage %'
  ];
  
  let csvContent = headers.join(',') + '\n';
  
  results.forEach((r, resultIndex) => {
    // Add rows for ALL results (both successful and failed)
    if (r.allPositions && r.allPositions.length > 0) {
      r.allPositions.forEach(positionData => {
        // Calculate actual position and position match for expected products
        let actualPosition = '';
        let positionMatch = '';
        let whereFound = '';
        
        if (positionData.expectedSku && r.actualProducts) {
          const actualIndex = r.actualProducts.findIndex(p => p.sku === positionData.expectedSku);
          if (actualIndex !== -1) {
            actualPosition = actualIndex + 1;
            positionMatch = actualPosition === positionData.position ? 'Match' : 'Mismatch';
            whereFound = `Position ${actualPosition}`;
          } else {
            actualPosition = 'No Record Found For Expected SKU :- ' + positionData.expectedSku;
            positionMatch = 'Not Match';
            whereFound = 'Not Found in Results';
          }
        }
        
        const row = [
          `"${(r.query || '').replace(/"/g, '""')}"`,
          `"${(positionData.expectedName || '').replace(/"/g, '""')}"`,
          `"${(positionData.actualName || 'No Product').replace(/"/g, '""')}"`,
          `"${positionData.expectedSku || ''}"`,
          `"${positionData.actualSku || 'N/A'}"`,
          `"${positionData.expectedPosition || positionData.position}"`,
          `"${actualPosition}"`,
          `"${positionMatch}"`,
          `"${r.firstPageTracking ? `${r.firstPageTracking.foundOnFirstPage} of ${r.firstPageTracking.totalExpected}` : 'N/A'}"`,
          `"${r.firstPageTracking && r.firstPageTracking.totalExpected > 0 ? ((r.firstPageTracking.foundOnFirstPage / r.firstPageTracking.totalExpected) * 100).toFixed(1) + '%' : 'N/A'}"`
        ];
        csvContent += row.join(',') + '\n';
      });
      
      // Add 2 blank rows after each query group (except the last one)
      if (resultIndex < results.length - 1) {
        csvContent += '\n\n';
      }
    }
  });
  
  return csvContent;
}

test.describe('API Testing - Complete Validation Suite', () => {
  test('Complete API testing with CSV input and comprehensive validation', async ({ request }) => {
    test.setTimeout(60000000); // 60 minute timeout for large datasets
    
    const csvPath = './API TEST INPUT.csv';
    const apiBaseUrl = 'https://aezfjci5yr.us-east-1.awsapprunner.com';
    const testResults = [];
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('🚀 API TESTING - COMPLETE VALIDATION SUITE');
    console.log(`${'='.repeat(80)}`);
    console.log(`📋 Input CSV: ${csvPath}`);
    console.log(`🌐 API Endpoint: ${apiBaseUrl}/api/v1/search.json`);
    console.log(`${'='.repeat(80)}`);
    
    // Read and parse CSV file
    const testCases = await new Promise((resolve, reject) => {
      const rawData = [];
      fs.createReadStream(csvPath)
        .pipe(csv({ bom: true }))
        .on('data', (row) => {
          // Handle BOM in column names
          const query = row.query || row['﻿query'] || row['\ufeffquery'];
          const name = row.name;
          const sku = row.sku;
          const position = row.position;
          
          // If query is empty but name/sku/position exist, use the last seen query
          if (name && sku && position) {
            rawData.push({
              query: query && query.trim() ? query.trim() : (rawData.length > 0 ? rawData[rawData.length - 1].query : ''),
              expectedName: name,
              expectedSku: sku,
              expectedPosition: parseInt(position) || null
            });
          }
        })
        .on('end', () => {
          // Group by query
          const grouped = {};
          rawData.forEach(item => {
            if (!grouped[item.query]) {
              grouped[item.query] = [];
            }
            grouped[item.query].push({
              expectedName: item.expectedName,
              expectedSku: item.expectedSku,
              expectedPosition: item.expectedPosition
            });
          });
          
          // Convert to array format
          const queries = Object.keys(grouped).map(query => ({
            query: query,
            expectedProducts: grouped[query].sort((a, b) => a.expectedPosition - b.expectedPosition)
          }));
          
          resolve(queries);
        })
        .on('error', reject);
    });
    
    console.log(`📊 Total Test Cases: ${testCases.length}\n`);
    console.log(`⚠️  Rate Limiting Protection: Using aggressive delays and rotation to ensure all queries return results\n`);
    
    // Process each query from CSV
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`\n[TEST ${i + 1}/${testCases.length}] 🔍 Query: "${testCase.query}"`);
      console.log(`📋 Expected Products: ${testCase.expectedProducts.length}`);
      console.log('-'.repeat(60));
      
      const startTime = Date.now();
      const result = {
        testNumber: i + 1,
        query: testCase.query,
        expectedProducts: testCase.expectedProducts,
        apiStatus: null,
        responseTime: null,
        totalResults: 0,
        productsOnPage: 0,
        positionComparisons: [],
        allPositions: [],
        actualProducts: [],
        firstPageTracking: null,
        testResult: 'PENDING'
      };
      
      try {
        // Search across multiple pages to find all expected products
        const searchResult = await searchAcrossPages(
          request,
          apiBaseUrl,
          testCase.query,
          testCase.expectedProducts,
          5, // maxPages - configurable
          i  // queryIndex for header variation
        );
        
        result.responseTime = Date.now() - startTime;
        result.apiStatus = 200; // If we got here, at least one page succeeded
        result.totalResults = searchResult.totalResults;
        result.productsOnPage = searchResult.allProducts.length;
        result.pagesSearched = searchResult.pagesSearched;
        
        if (searchResult.allProducts && searchResult.allProducts.length > 0) {
          const products = searchResult.allProducts;
          result.actualProducts = products; // Store for CSV generation
          
          // Find actual positions of all expected products
          const productPositionMapping = findAllProductPositions(testCase.expectedProducts, products);
          result.productPositionMapping = productPositionMapping;
          
          // Count expected products found on first page
          result.firstPageTracking = countExpectedProductsOnFirstPage(testCase.expectedProducts, products);
          
          // COMPLETE PRODUCT LISTING - Show all products at every position
          console.log(`\n📋 Complete Product Listing (All ${products.length} products from ${result.pagesSearched} page(s)):`);
          console.log(`${'Page'.padEnd(4)} | ${'Pos'.padEnd(4)} | ${'Product Name'.padEnd(55)} | ${'SKU'.padEnd(15)} | Expected?`);
          console.log('-'.repeat(100));
          
          // Create a map of expected products by position for quick lookup
          const expectedByPosition = {};
          testCase.expectedProducts.forEach(exp => {
            expectedByPosition[exp.expectedPosition] = exp;
          });
          
          let exactMatches = 0;
          let totalExpected = testCase.expectedProducts.length;
          
          // Process ALL products returned by API
          for (let i = 0; i < products.length; i++) {
            const actualProduct = products[i];
            const position = actualProduct.absolutePosition || (i + 1);
            const pageNum = actualProduct.pageNumber || 1;
            const expectedAtThisPosition = expectedByPosition[position];
            
            let matchStatus = 'No expectation';
            let status = '';  // Empty status for products without expectations
            
            // Create position data for CSV (ALL positions)
            const positionData = {
              position: position,
              actualName: actualProduct.name,
              actualSku: actualProduct.sku,
              expectedName: expectedAtThisPosition ? expectedAtThisPosition.expectedName : null,
              expectedSku: expectedAtThisPosition ? expectedAtThisPosition.expectedSku : null,
              expectedPosition: expectedAtThisPosition ? expectedAtThisPosition.expectedPosition : null,
              status: status
            };
            
            if (expectedAtThisPosition) {
              const comparison = {
                position: position,
                expectedName: expectedAtThisPosition.expectedName,
                expectedSku: expectedAtThisPosition.expectedSku,
                actualName: actualProduct.name,
                actualSku: actualProduct.sku,
                match: 'Not Match'
              };
              
              // Check if SKUs match
              if (actualProduct.sku === expectedAtThisPosition.expectedSku) {
                comparison.match = 'Match';
                matchStatus = `✅ MATCH (Expected: ${expectedAtThisPosition.expectedName})`;
                status = 'Exact Match';
                exactMatches++;
              } else {
                comparison.match = 'Not Match';
                matchStatus = `❌ MISMATCH (Expected: ${expectedAtThisPosition.expectedName} | SKU: ${expectedAtThisPosition.expectedSku})`;
                status = 'Position Mismatch';
              }
              
              result.positionComparisons.push(comparison);
              positionData.status = status;
            }
            
            result.allPositions.push(positionData);
            
            // Display product info
            const productName = actualProduct.name?.substring(0, 58) || 'N/A';
            const sku = actualProduct.sku || 'N/A';
            
            console.log(`${pageNum.toString().padEnd(4)} | ${position.toString().padEnd(4)} | ${productName.padEnd(55)} | ${sku.padEnd(15)} | ${matchStatus}`);
          }
          
          // Handle expected products at positions beyond what API returned
          for (const expectedProduct of testCase.expectedProducts) {
            if (expectedProduct.expectedPosition > products.length) {
              const comparison = {
                position: expectedProduct.expectedPosition,
                expectedName: expectedProduct.expectedName,
                expectedSku: expectedProduct.expectedSku,
                actualName: null,
                actualSku: null,
                match: 'No Product at Position'
              };
              
              const positionData = {
                position: expectedProduct.expectedPosition,
                actualName: null,
                actualSku: null,
                expectedName: expectedProduct.expectedName,
                expectedSku: expectedProduct.expectedSku,
                expectedPosition: expectedProduct.expectedPosition,
                status: 'Missing Product'
              };
              
              result.positionComparisons.push(comparison);
              result.allPositions.push(positionData);
              console.log(`${'N/A'.padEnd(4)} | ${expectedProduct.expectedPosition.toString().padEnd(4)} | ${'[NO PRODUCT RETURNED]'.padEnd(55)} | ${'N/A'.padEnd(15)} | ❌ EXPECTED: ${expectedProduct.expectedName} (${expectedProduct.expectedSku})`);
            }
          }
          
          // Calculate match results
          result.testResult = `${exactMatches}/${totalExpected} matches`;
          
          console.log('-'.repeat(100));
          console.log(`📈 Summary: ${exactMatches}/${totalExpected} exact position matches | Total Products Found: ${products.length} across ${result.pagesSearched} page(s)`);
          
          // Show where ALL expected products were found (or not found)
          console.log(`\n🔍 All Expected Products - Where They Were Found:`);
          console.log(`${'Product Name'.padEnd(45)} | ${'SKU'.padEnd(15)} | ${'Expected Pos'.padEnd(12)} | ${'Page'.padEnd(4)} | ${'Actual Pos'.padEnd(10)} | Status`);
          console.log('-'.repeat(115));
          
          for (const mapping of productPositionMapping) {
            const productName = (mapping.expectedName || '').substring(0, 43);
            const sku = mapping.expectedSku || 'N/A';
            const expectedPos = mapping.expectedPosition ? mapping.expectedPosition.toString() : 'N/A';
            const actualPos = mapping.actualPosition ? mapping.actualPosition.toString() : 'NOT FOUND';
            const pageNum = mapping.pageNumber ? mapping.pageNumber.toString() : 'N/A';
            
            let statusSymbol = '';
            if (mapping.status === 'Exact Match') {
              statusSymbol = '✅';
            } else if (mapping.status.startsWith('Found at Position')) {
              statusSymbol = '⚠️';
            } else {
              statusSymbol = '❌';
            }
            
            console.log(`${productName.padEnd(45)} | ${sku.padEnd(15)} | ${expectedPos.padEnd(12)} | ${pageNum.padEnd(4)} | ${actualPos.padEnd(10)} | ${statusSymbol} ${mapping.status}`);
          }
          console.log('-'.repeat(115));
          
          // Display first page tracking results
          if (result.firstPageTracking) {
            console.log(`\n📄 First Page Tracking (First 24 products):`);
            console.log(`Found: ${result.firstPageTracking.foundOnFirstPage}/${result.firstPageTracking.totalExpected} expected products`);
            if (result.firstPageTracking.totalExpected > 0) {
              const coverage = ((result.firstPageTracking.foundOnFirstPage / result.firstPageTracking.totalExpected) * 100).toFixed(1);
              console.log(`Coverage: ${coverage}%`);
            }
            
            if (result.firstPageTracking.foundProducts.length > 0) {
              console.log(`\n🎯 Expected Products Found on First Page:`);
              console.log(`${'Product Name'.padEnd(40)} | ${'SKU'.padEnd(15)} | Position`);
              console.log('-'.repeat(70));
              result.firstPageTracking.foundProducts.forEach(product => {
                const name = (product.expectedName || '').substring(0, 38);
                console.log(`${name.padEnd(40)} | ${(product.expectedSku || '').padEnd(15)} | ${product.actualPosition}`);
              });
              console.log('-'.repeat(70));
            }
          }
        } else {
          result.testResult = 'FAIL - No products returned';
          console.log(`\n❌ No products returned in response`);
        }
        
      } catch (error) {
        console.error(`\n❌ Query Failed: ${error.message}`);
        result.apiStatus = 'ERROR';
        result.testResult = `FAILED - ${error.message}`;
        result.responseTime = Date.now() - startTime;
        result.totalResults = 0;
        result.productsOnPage = 0;
        
        // Add simple 'No Response' entry for failed queries - don't include expected product details
        // This prevents failed queries from appearing as successful in HTML reports
        result.allPositions = [{
          position: 1,
          actualName: 'No Response',
          actualSku: 'No Response', 
          expectedName: 'No Response',
          expectedSku: 'No Response',
          expectedPosition: 1,
          status: 'No Response'
        }];
        
        console.log(`\n⚠️ Continuing with next query despite this failure...`);
        // DON'T throw the error - continue processing remaining queries
      }
      
      testResults.push(result);
      
      // Add human-like delays with burst protection
      if (i < testCases.length - 1) {
        let baseDelay = 12000; // Base 12 seconds
        
        // Burst protection: Add extra delay after every 5 queries
        if ((i + 1) % 5 === 0) {
          baseDelay += 15000; // Extra 15 seconds after every 5 queries
          console.log(`\n⏳ Burst protection activated: Waiting ${baseDelay/1000} seconds after 5 queries...`);
        } else {
          console.log(`\n⏳ Human-like delay: Waiting ${baseDelay/1000} seconds before next query...`);
        }
        
        // Add random variation to make timing less predictable (±5 seconds)
        const randomVariation = (Math.random() - 0.5) * 10000;
        const totalDelay = Math.max(8000, baseDelay + randomVariation); // Minimum 8 seconds
        
        await delay(totalDelay);
      }
    }
    
    // GENERATE COMPREHENSIVE SUMMARY
    console.log(`\n${'='.repeat(80)}`);
    console.log('📈 FINAL TEST SUMMARY - ALL QUERIES PROCESSED');
    console.log(`${'='.repeat(80)}`);
    
    // Categorize results
    const successfulQueries = testResults.filter(r => !r.testResult.startsWith('FAILED'));
    const failedQueries = testResults.filter(r => r.testResult.startsWith('FAILED'));
    
    const totalComparisons = testResults.reduce((total, result) => total + (result.positionComparisons?.length || 0), 0);
    const totalMatches = testResults.reduce((total, result) => 
      total + (result.positionComparisons?.filter(comp => comp.match === 'Match').length || 0), 0);
    
    console.log(`📊 Query Execution Summary:`);
    console.log(`  📋 Total Queries Processed: ${testResults.length}`);
    console.log(`  ✅ Successful Queries: ${successfulQueries.length}`);
    console.log(`  ❌ Failed Queries: ${failedQueries.length}`);
    console.log(`  📈 Success Rate: ${Math.round((successfulQueries.length / testResults.length) * 100)}%`);
    
    if (successfulQueries.length > 0) {
      console.log(`\n📊 Position Matching Results (Successful Queries Only):`);
      console.log(`  🎯 Total Position Comparisons: ${totalComparisons}`);
      console.log(`  ✅ Exact Position Matches: ${totalMatches}`);
      console.log(`  ⚠️ Position Mismatches: ${totalComparisons - totalMatches}`);
      console.log(`  📈 Overall Match Rate: ${totalMatches}/${totalComparisons}`);
    }
    
    console.log(`\n📋 Detailed Query Results:`);
    testResults.forEach((result, index) => {
      const matches = result.positionComparisons?.filter(comp => comp.match === 'Match').length || 0;
      const total = result.positionComparisons?.length || 0;
      const status = result.testResult.startsWith('FAILED') ? '❌ FAILED' : '✅ SUCCESS';
      console.log(`  ${index + 1}. "${result.query}": ${status} - ${matches}/${total} matches`);
    });
    
    if (failedQueries.length > 0) {
      console.log(`\n❌ Failed Queries Details:`);
      failedQueries.forEach((result, index) => {
        console.log(`  • "${result.query}": ${result.testResult}`);
      });
      console.log(`\n💡 Note: Failed queries are included in the CSV report for complete documentation.`);
    }
    
    // SAVE RESULTS TO CSV FILE
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeString = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    
    // Save CSV output
    const outputCsvPath = `./Output Reports/POSITION_COMPARISON_${timestamp}_${timeString}.csv`;
    const csvContent = generateCSV(testResults);
    fs.writeFileSync(outputCsvPath, csvContent);
    console.log(`\n💾 Results Saved:`);
    console.log(`  📋 Position Comparison Report: ${outputCsvPath}`);
    
    // Generate HTML report with charts
    try {
      const reportGenerator = new ReportGeneratorClient();
      const htmlReportPath = await reportGenerator.generateHTMLReport(csvContent, './Output Reports');
      console.log(`  📊 HTML Report with Charts: ${htmlReportPath}`);
    } catch (error) {
      console.log(`  ⚠️ Could not generate HTML report: ${error.message}`);
    }
    
    console.log(`\n${'='.repeat(80)}`);
    if (failedQueries.length === 0) {
      console.log('🎉 API TESTING COMPLETED - ALL QUERIES SUCCESSFUL');
    } else {
      console.log(`🏁 API TESTING COMPLETED - ${successfulQueries.length}/${testResults.length} QUERIES SUCCESSFUL`);
    }
    console.log(`${'='.repeat(80)}\n`);
  });
});