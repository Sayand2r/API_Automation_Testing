const { test, expect } = require('@playwright/test');
const fs = require('fs');
const csv = require('csv-parser');

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


// Helper function to determine word position in text
function getWordPosition(text, searchWord) {
  if (!text || !searchWord) return null;
  
  const lowerText = text.toLowerCase();
  const lowerWord = searchWord.toLowerCase();
  const wordIndex = lowerText.indexOf(lowerWord);
  
  if (wordIndex === -1) return null;
  
  // Check if word appears at the beginning (first 20% of text)
  if (wordIndex === 0 || wordIndex / text.length < 0.2) {
    return 'beginning';
  }
  
  // Check if word appears at the end (last 20% of text)
  if ((wordIndex + searchWord.length) >= text.length || 
      wordIndex / text.length > 0.8) {
    return 'end';
  }
  
  // Otherwise it's in the middle
  return 'middle';
}

// Function to analyze word positions in product descriptions
function analyzeWordPositions(products, searchQuery) {
  const stats = {
    beginning: 0,
    middle: 0,
    end: 0,
    notFound: 0,
    details: []
  };
  
  const searchWords = searchQuery.toLowerCase().split(/\s+/);
  
  products.forEach((product, index) => {
    const description = product.description || product.name || '';
    let foundPosition = null;
    
    // Check each word from the search query
    for (const word of searchWords) {
      const position = getWordPosition(description, word);
      if (position) {
        foundPosition = position;
        stats[position]++;
        stats.details.push({
          productIndex: index,
          productName: product.name,
          sku: product.sku,
          word: word,
          position: position,
          description: description.substring(0, 100) + (description.length > 100 ? '...' : '')
        });
        break; // Count only the first matching word
      }
    }
    
    if (!foundPosition) {
      stats.notFound++;
    }
  });
  
  return stats;
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
      const actualPosition = foundIndex + 1;
      positionMapping.push({
        expectedName: exp.expectedName,
        expectedSku: exp.expectedSku,
        expectedPosition: exp.expectedPosition,
        actualPosition: actualPosition,
        status: actualPosition === exp.expectedPosition ? 'Exact Match' : `Found at Position ${actualPosition}`,
        actualProduct: actualProducts[foundIndex]
      });
    } else {
      positionMapping.push({
        expectedName: exp.expectedName,
        expectedSku: exp.expectedSku,
        expectedPosition: exp.expectedPosition,
        actualPosition: null,
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
    'Input Expected SKU',
    'Input Expected Position',
    'Actual Product Name',
    'Actual SKU',
    'Actual Position',
    'Position Match',
    'Position Status',
    'Where Found'
  ];
  
  let csvContent = headers.join(',') + '\n';
  
  results.forEach(r => {
    // Add rows for ALL API results
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
          `"${r.query}"`,
          `"${positionData.expectedName || ''}"`,
          positionData.expectedSku || '',
          positionData.expectedPosition || positionData.position,
          `"${positionData.actualName || 'No Product'}"`,
          positionData.actualSku || 'N/A',
          actualPosition,
          positionMatch,
          positionData.status,
          whereFound
        ];
        csvContent += row.join(',') + '\n';
      });
    }
  });
  
  return csvContent;
}

test.describe('API Testing - Complete Validation Suite', () => {
  test('Complete API testing with CSV input and comprehensive validation', async ({ request }) => {
    test.setTimeout(300000); // 5 minute timeout
    
    const csvPath = './API TEST INPUT.csv';
    const apiBaseUrl = 'https://pvaewimjnq.us-east-1.awsapprunner.com';
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
        testResult: 'PENDING'
      };
      
      try {
        // Make API request to search.json endpoint
        const response = await request.get(`${apiBaseUrl}/api/v1/search.json`, {
          params: {
            siteId: 'os7898',
            q: testCase.query,
            use_cache: 'false'
          },
          timeout: 30000
        });
        
        result.responseTime = Date.now() - startTime;
        result.apiStatus = response.status();
        
        // Validate API response
        expect(response.status()).toBe(200);
        
        const responseData = await response.json();
        result.totalResults = responseData.pagination?.totalResults || 0;
        result.productsOnPage = responseData.results?.length || 0;
        
        if (responseData.results && responseData.results.length > 0) {
          const products = responseData.results;
          result.actualProducts = products; // Store for CSV generation
          
          // Find actual positions of all expected products
          const productPositionMapping = findAllProductPositions(testCase.expectedProducts, products);
          result.productPositionMapping = productPositionMapping;
          
          // COMPLETE PRODUCT LISTING - Show all products at every position
          console.log(`\n📋 Complete Product Listing (All ${products.length} products):`);
          console.log(`${'Pos'.padEnd(4)} | ${'Product Name'.padEnd(60)} | ${'SKU'.padEnd(15)} | Expected?`);
          console.log('-'.repeat(95));
          
          // Create a map of expected products by position for quick lookup
          const expectedByPosition = {};
          testCase.expectedProducts.forEach(exp => {
            expectedByPosition[exp.expectedPosition] = exp;
          });
          
          let exactMatches = 0;
          let totalExpected = testCase.expectedProducts.length;
          
          // Process ALL products returned by API
          for (let i = 0; i < products.length; i++) {
            const position = i + 1;
            const actualProduct = products[i];
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
            
            console.log(`${position.toString().padEnd(4)} | ${productName.padEnd(60)} | ${sku.padEnd(15)} | ${matchStatus}`);
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
              console.log(`${expectedProduct.expectedPosition.toString().padEnd(4)} | ${'[NO PRODUCT RETURNED]'.padEnd(60)} | ${'N/A'.padEnd(15)} | ❌ EXPECTED: ${expectedProduct.expectedName} (${expectedProduct.expectedSku})`);
            }
          }
          
          // Calculate match results
          result.testResult = `${exactMatches}/${totalExpected} matches`;
          
          console.log('-'.repeat(95));
          console.log(`📈 Summary: ${exactMatches}/${totalExpected} exact position matches | Total API Results: ${products.length}`);
          
          // Show where ALL expected products were found (or not found)
          console.log(`\n🔍 All Expected Products - Where They Were Found:`);
          console.log(`${'Product Name'.padEnd(50)} | ${'SKU'.padEnd(15)} | ${'Expected Pos'.padEnd(12)} | ${'Actual Pos'.padEnd(12)} | Status`);
          console.log('-'.repeat(110));
          
          for (const mapping of productPositionMapping) {
            const productName = (mapping.expectedName || '').substring(0, 48);
            const sku = mapping.expectedSku || 'N/A';
            const expectedPos = mapping.expectedPosition ? mapping.expectedPosition.toString() : 'N/A';
            const actualPos = mapping.actualPosition ? mapping.actualPosition.toString() : 'NOT FOUND';
            
            let statusSymbol = '';
            if (mapping.status === 'Exact Match') {
              statusSymbol = '✅';
            } else if (mapping.status.startsWith('Found at Position')) {
              statusSymbol = '⚠️';
            } else {
              statusSymbol = '❌';
            }
            
            console.log(`${productName.padEnd(50)} | ${sku.padEnd(15)} | ${expectedPos.padEnd(12)} | ${actualPos.padEnd(12)} | ${statusSymbol} ${mapping.status}`);
          }
          console.log('-'.repeat(110));
        } else {
          result.testResult = 'FAIL - No products returned';
          console.log(`\n❌ No products returned in response`);
        }
        
      } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        result.apiStatus = 'ERROR';
        result.testResult = `ERROR - ${error.message}`;
        result.responseTime = Date.now() - startTime;
        throw error;
      }
      
      testResults.push(result);
    }
    
    // GENERATE COMPREHENSIVE SUMMARY
    console.log(`\n${'='.repeat(80)}`);
    console.log('📈 POSITION-BY-POSITION TEST SUMMARY');
    console.log(`${'='.repeat(80)}`);
    
    const totalComparisons = testResults.reduce((total, result) => total + (result.positionComparisons?.length || 0), 0);
    const totalMatches = testResults.reduce((total, result) => 
      total + (result.positionComparisons?.filter(comp => comp.match === 'Match').length || 0), 0);
    
    console.log(`📊 Overall Results:`);
    console.log(`  🎯 Total Position Comparisons: ${totalComparisons}`);
    console.log(`  ✅ Exact Position Matches: ${totalMatches}`);
    console.log(`  ⚠️ Position Mismatches: ${totalComparisons - totalMatches}`);
    
    console.log(`  📈 Overall Match Rate: ${totalMatches}/${totalComparisons}`);
    
    console.log(`\n📋 Test Case Results:`);
    testResults.forEach((result, index) => {
      const matches = result.positionComparisons?.filter(comp => comp.match === 'Match').length || 0;
      const total = result.positionComparisons?.length || 0;
      console.log(`  ${index + 1}. "${result.query}": ${matches}/${total} matches`);
    });
    
    // SAVE RESULTS TO CSV FILE
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeString = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    
    // Save CSV output only
    const outputCsvPath = `./Output Reports/POSITION_COMPARISON_${timestamp}_${timeString}.csv`;
    const csvContent = generateCSV(testResults);
    fs.writeFileSync(outputCsvPath, csvContent);
    console.log(`\n💾 Results Saved:`);
    console.log(`  📋 Position Comparison Report: ${outputCsvPath}`);
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎉 API TESTING COMPLETED SUCCESSFULLY');
    console.log(`${'='.repeat(80)}\n`);
  });
});