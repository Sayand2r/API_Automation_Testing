const fs = require('fs');
const path = require('path');

class ReportGeneratorClient {
    /**
     * Parse CSV data and group by query
     */
    parseCSVData(csvContent) {
        const lines = csvContent.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        
        const queryGroups = {};
        
        for (let i = 1; i < lines.length; i++) {
            const row = this.parseCSVRow(lines[i]);
            if (row.length < headers.length) continue;
            
            const query = row[0].replace(/"/g, '').trim();
            const positionMatch = row[7] ? row[7].replace(/"/g, '').trim() : '';
            const firstPageCount = row[8] ? row[8].replace(/"/g, '').trim() : '';
            const firstPageCoverage = row[9] ? row[9].replace(/"/g, '').trim() : '';
            
            if (!query) continue;
            
            if (!queryGroups[query]) {
                queryGroups[query] = {
                    query: query,
                    totalExpected: 0,
                    matches: 0,
                    mismatches: 0,
                    notMatch: 0,
                    firstPageCount: '',
                    firstPageCoverage: '',
                    details: []
                };
            }
            
            const expectedName = row[1].replace(/"/g, '').trim();
            const actualName = row[2].replace(/"/g, '').trim();
            const expectedSku = row[3].replace(/"/g, '').trim();
            const actualSku = row[4].replace(/"/g, '').trim();
            const expectedPos = row[5].replace(/"/g, '').trim();
            const actualPos = row[6].replace(/"/g, '').trim();
            
            if (expectedName) {
                queryGroups[query].totalExpected++;
                
                if (positionMatch.toLowerCase() === 'match') {
                    queryGroups[query].matches++;
                } else if (positionMatch.toLowerCase() === 'mismatch') {
                    queryGroups[query].mismatches++;
                } else if (positionMatch.toLowerCase() === 'not match') {
                    queryGroups[query].notMatch++;
                }
            }
            
            // Capture first page tracking data (only set once per query)
            if (firstPageCount && !queryGroups[query].firstPageCount) {
                queryGroups[query].firstPageCount = firstPageCount;
            }
            if (firstPageCoverage && !queryGroups[query].firstPageCoverage) {
                queryGroups[query].firstPageCoverage = firstPageCoverage;
            }
            
            queryGroups[query].details.push({
                expectedName,
                actualName,
                expectedSku,
                actualSku,
                expectedPos,
                actualPos,
                status: positionMatch
            });
        }
        
        // Calculate accuracy for each query
        Object.values(queryGroups).forEach(group => {
            group.accuracy = group.totalExpected > 0 
                ? ((group.matches / group.totalExpected) * 100).toFixed(2)
                : 0;
            
            // Count not found / no record found cases
            group.notMatch = group.notMatch || 0;
        });
        
        return queryGroups;
    }

    /**
     * Parse a CSV row handling quoted values
     */
    parseCSVRow(row) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        
        return result;
    }


    /**
     * Generate HTML report with client-side Chart.js
     */
    async generateHTMLReport(csvContent, outputPath, testResults = []) {
        const queryGroups = this.parseCSVData(csvContent);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        
        // Calculate overall statistics
        const overallStats = {
            totalQueries: Object.keys(queryGroups).length,
            totalProducts: 0,
            totalMatches: 0,
            totalMismatches: 0,
            averageAccuracy: 0,
            firstPageTracking: {
                totalFound: 0,
                totalExpected: 0,
                averageCoverage: 0
            }
        };
        
        Object.values(queryGroups).forEach(group => {
            overallStats.totalProducts += group.totalExpected;
            overallStats.totalMatches += group.matches;
            overallStats.totalMismatches += group.mismatches;
        });
        
        overallStats.averageAccuracy = overallStats.totalProducts > 0
            ? ((overallStats.totalMatches / overallStats.totalProducts) * 100).toFixed(2)
            : 0;
        
        
        // Calculate first page tracking stats
        Object.values(queryGroups).forEach(group => {
            if (group.firstPageCount) {
                // Handle different formats: "8/8", "8 of 8", "24 of 100", etc.
                const cleanCount = group.firstPageCount.replace(/\s+/g, ' ');
                let parts = cleanCount.split('/');
                if (parts.length !== 2) {
                    parts = cleanCount.split(' of ');
                }
                
                if (parts.length === 2) {
                    // For counting, use matches/totalExpected to ensure we count input products only
                    overallStats.firstPageTracking.totalFound += group.matches;
                    overallStats.firstPageTracking.totalExpected += group.totalExpected;
                } else {
                    // Fallback to using matches/totalExpected
                    overallStats.firstPageTracking.totalFound += group.matches;
                    overallStats.firstPageTracking.totalExpected += group.totalExpected;
                }
            } else {
                // Fallback when no firstPageCount available
                overallStats.firstPageTracking.totalFound += group.matches;
                overallStats.firstPageTracking.totalExpected += group.totalExpected;
            }
        });
        
        overallStats.firstPageTracking.averageCoverage = overallStats.firstPageTracking.totalExpected > 0
            ? ((overallStats.firstPageTracking.totalFound / overallStats.firstPageTracking.totalExpected) * 100).toFixed(2)
            : 0;
        
        // Generate HTML with client-side Chart.js
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Test Report with Accuracy Charts</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }
        
        h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .timestamp {
            opacity: 0.9;
            font-size: 1.1em;
        }
        
        .overall-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }
        
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .stat-value {
            font-size: 2.5em;
            font-weight: bold;
            color: #667eea;
        }
        
        .stat-label {
            color: #666;
            margin-top: 5px;
            font-size: 0.9em;
        }
        
        .query-section {
            padding: 30px;
            border-bottom: 1px solid #e0e0e0;
        }
        
        .query-section:last-child {
            border-bottom: none;
        }
        
        .query-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 15px;
        }
        
        .query-title {
            font-size: 1.5em;
            color: #333;
        }
        
        .accuracy-badge {
            padding: 10px 20px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 1.2em;
        }
        
        .accuracy-high {
            background: #d4edda;
            color: #155724;
        }
        
        .accuracy-medium {
            background: #fff3cd;
            color: #856404;
        }
        
        .accuracy-low {
            background: #f8d7da;
            color: #721c24;
        }
        
        .query-content {
            display: grid;
            grid-template-columns: 1fr 400px;
            gap: 30px;
            align-items: center;
        }
        
        .query-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
        }
        
        .query-stat {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }
        
        .query-stat:hover {
            background: #e9ecef;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border-color: #667eea;
        }
        
        .query-stat-value {
            font-size: 1.8em;
            font-weight: bold;
            color: #495057;
        }
        
        .query-stat-label {
            color: #6c757d;
            font-size: 0.9em;
        }
        
        .chart-container {
            text-align: center;
            position: relative;
            height: 300px;
            width: 100%;
        }
        
        .progress-bar {
            width: 100%;
            height: 30px;
            background: #e0e0e0;
            border-radius: 15px;
            overflow: hidden;
            margin-top: 20px;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #8BC34A);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            transition: width 0.5s ease;
        }
        
        .summary-chart {
            max-width: 600px;
            margin: 30px auto;
            padding: 20px;
        }
        
        .product-list {
            margin-top: 20px;
            display: none;
            animation: slideDown 0.3s ease;
        }
        
        .product-list.show {
            display: block;
        }
        
        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .product-list h3 {
            color: #333;
            margin-bottom: 15px;
            padding: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 5px;
            font-size: 1.1em;
        }
        
        .product-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .product-table th,
        .product-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e0e0e0;
        }
        
        .product-table th {
            background: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }
        
        .product-table tr:hover {
            background: #f8f9fa;
        }
        
        .status-match {
            color: #28a745;
            font-weight: bold;
        }
        
        .status-mismatch {
            color: #dc3545;
            font-weight: bold;
        }
        
        .status-not-match {
            color: #6c757d;
            font-weight: bold;
        }
        
        .query-stat.active {
            background: #667eea;
            color: white;
            border-color: #5a67d8;
        }
        
        .query-stat.active .query-stat-value,
        .query-stat.active .query-stat-label {
            color: white;
        }
        
        .query-hidden {
            display: none !important;
        }
        
        .relevance-perfect {
            background: linear-gradient(135deg, #28a745, #20c997);
        }
        
        .relevance-near {
            background: linear-gradient(135deg, #ffc107, #fd7e14);
        }
        
        .relevance-fair {
            background: linear-gradient(135deg, #fd7e14, #e83e8c);
        }
        
        .relevance-far {
            background: linear-gradient(135deg, #dc3545, #6f42c1);
        }
        
        .relevance-none {
            background: linear-gradient(135deg, #6c757d, #495057);
        }

        @media (max-width: 768px) {
            .query-content {
                grid-template-columns: 1fr;
            }
            
            .overall-stats {
                grid-template-columns: 1fr;
            }
            
            .chart-container {
                height: 250px;
            }
            
            .product-table {
                font-size: 0.9em;
            }
            
            .product-table th,
            .product-table td {
                padding: 8px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 API Test Report with Accuracy Charts</h1>
            <div class="timestamp">Generated: ${new Date().toLocaleString()}</div>
        </div>
        
        <div class="overall-stats">
            <div class="stat-card">
                <div class="stat-value">${overallStats.totalQueries}</div>
                <div class="stat-label">Total Queries</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${overallStats.totalProducts}</div>
                <div class="stat-label">Total Products Tested</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${overallStats.totalMatches}</div>
                <div class="stat-label">Total Matches</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${overallStats.totalMismatches}</div>
                <div class="stat-label">Total Mismatches</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${overallStats.averageAccuracy}%</div>
                <div class="stat-label">Average Accuracy</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${overallStats.firstPageTracking.totalFound}/${overallStats.firstPageTracking.totalExpected}</div>
                <div class="stat-label">First Page Found</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${overallStats.firstPageTracking.averageCoverage}%</div>
                <div class="stat-label">First Page Coverage</div>
            </div>
        </div>
        
        <!-- Summary Chart -->
        <div style="padding: 30px;">
            <div class="summary-chart">
                <h2 style="text-align: center; margin-bottom: 20px; color: #333;">Accuracy Performance</h2>
                <div style="position: relative; height: 400px;">
                    <canvas id="summaryChart"></canvas>
                </div>
            </div>
        </div>
        
        <!-- Search and Filter Controls -->
        <div style="padding: 20px; background: #f8f9fa;">
            <div style="display: flex; justify-content: center; align-items: center; gap: 15px; flex-wrap: wrap;">
                <!-- Search Box with Clear Button -->
                <div style="position: relative; display: inline-flex; align-items: center;">
                    <input 
                        type="text" 
                        id="simpleQuerySearch" 
                        placeholder="🔍 Search for a query (e.g., 'carbide', 'gripper')..." 
                        style="width: 400px; padding: 12px 40px 12px 15px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; outline: none;"
                        onkeyup="applyFilters()"
                    />
                    <button 
                        id="clearSearchBtn"
                        onclick="clearSearchQuery()" 
                        style="position: absolute; right: 5px; padding: 8px 12px; background: #dc3545; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; display: none;"
                        title="Clear search"
                    >
                        ✕
                    </button>
                </div>
                
                <!-- Accuracy Filter Dropdown -->
                <select 
                    id="accuracyFilter" 
                    onchange="applyFilters()"
                    style="padding: 12px 15px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; outline: none; background: white; cursor: pointer;"
                >
                    <option value="all">All Accuracy Levels</option>
                    <option value="90-100">90-100%</option>
                    <option value="80-90">80-90%</option>
                    <option value="70-80">70-80%</option>
                    <option value="60-70">60-70%</option>
                    <option value="50-60">50-60%</option>
                    <option value="40-50">40-50%</option>
                    <option value="30-40">30-40%</option>
                    <option value="20-30">20-30%</option>
                    <option value="10-20">10-20%</option>
                    <option value="0-10">0-10%</option>
                </select>
                
                <button 
                    id="clearAllFiltersBtn"
                    onclick="clearFilters()" 
                    style="padding: 12px 20px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; display: none;"
                >
                    Clear All Filters
                </button>
            </div>
            <div id="filterInfo" style="margin-top: 10px; color: #666; font-size: 14px; text-align: center;"></div>
        </div>
        
        ${Object.entries(queryGroups).map(([query, data], index) => {
            const accuracyClass = data.accuracy >= 80 ? 'accuracy-high' : 
                                 data.accuracy >= 50 ? 'accuracy-medium' : 'accuracy-low';
            
            return `
            <div class="query-section" data-accuracy="${data.accuracy}">
                <div class="query-header">
                    <h2 class="query-title">Query: "${query}"</h2>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div class="accuracy-badge ${accuracyClass}">${data.accuracy}% Accuracy</div>
                    </div>
                </div>
                
                <div class="query-content">
                    <div>
                        <div class="query-stats">
                            <div class="query-stat" data-category="expected" data-query-index="${index}">
                                <div class="query-stat-value">${data.totalExpected}</div>
                                <div class="query-stat-label">Expected Products</div>
                            </div>
                            <div class="query-stat" data-category="matches" data-query-index="${index}">
                                <div class="query-stat-value">${data.matches}</div>
                                <div class="query-stat-label">Position Matches</div>
                            </div>
                            <div class="query-stat" data-category="mismatches" data-query-index="${index}">
                                <div class="query-stat-value">${data.mismatches}</div>
                                <div class="query-stat-label">Position Mismatches</div>
                            </div>
                            <div class="query-stat" data-category="notMatch" data-query-index="${index}">
                                <div class="query-stat-value">${data.notMatch}</div>
                                <div class="query-stat-label">Not Match</div>
                            </div>
                            <div class="query-stat" data-category="firstPageCount" data-query-index="${index}">
                                <div class="query-stat-value">${data.firstPageCount || 'N/A'}</div>
                                <div class="query-stat-label">First Page Count</div>
                            </div>
                            <div class="query-stat" data-category="firstPageCoverage" data-query-index="${index}">
                                <div class="query-stat-value">${data.firstPageCoverage || 'N/A'}</div>
                                <div class="query-stat-label">First Page Coverage</div>
                            </div>
                        </div>
                        
                        
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${data.accuracy}%">
                                ${data.accuracy}% Match Rate
                            </div>
                        </div>
                    </div>
                    
                    <div class="chart-container">
                        <canvas id="chart-${index}"></canvas>
                    </div>
                </div>
                
                <!-- Product Lists -->
                <div id="product-list-expected-${index}" class="product-list">
                    <h3>Expected Products</h3>
                    <table class="product-table">
                        <thead>
                            <tr>
                                <th>Expected Product</th>
                                <th>Expected SKU</th>
                                <th>Actual Product</th>
                                <th>Actual SKU</th>
                                <th>Expected Position</th>
                                <th>Actual Position</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.details.map(detail => `
                                <tr>
                                    <td>${detail.expectedName || 'N/A'}</td>
                                    <td>${detail.expectedSku || 'N/A'}</td>
                                    <td>${detail.actualName || 'N/A'}</td>
                                    <td>${detail.actualSku || 'N/A'}</td>
                                    <td>${detail.expectedPos || 'N/A'}</td>
                                    <td>${detail.actualPos || 'N/A'}</td>
                                    <td class="status-${detail.status.toLowerCase().replace(' ', '-')}">${detail.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                
                <div id="product-list-matches-${index}" class="product-list">
                    <h3>Position Matches</h3>
                    <table class="product-table">
                        <thead>
                            <tr>
                                <th>Expected Product</th>
                                <th>Expected SKU</th>
                                <th>Actual Product</th>
                                <th>Actual SKU</th>
                                <th>Expected Position</th>
                                <th>Actual Position</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.details.filter(detail => detail.status.toLowerCase() === 'match').map(detail => `
                                <tr>
                                    <td>${detail.expectedName || 'N/A'}</td>
                                    <td>${detail.expectedSku || 'N/A'}</td>
                                    <td>${detail.actualName || 'N/A'}</td>
                                    <td>${detail.actualSku || 'N/A'}</td>
                                    <td>${detail.expectedPos || 'N/A'}</td>
                                    <td>${detail.actualPos || 'N/A'}</td>
                                    <td class="status-match">${detail.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                
                <div id="product-list-mismatches-${index}" class="product-list">
                    <h3>Position Mismatches</h3>
                    <table class="product-table">
                        <thead>
                            <tr>
                                <th>Expected Product</th>
                                <th>Expected SKU</th>
                                <th>Actual Product</th>
                                <th>Actual SKU</th>
                                <th>Expected Position</th>
                                <th>Actual Position</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.details.filter(detail => detail.status.toLowerCase() === 'mismatch').map(detail => `
                                <tr>
                                    <td>${detail.expectedName || 'N/A'}</td>
                                    <td>${detail.expectedSku || 'N/A'}</td>
                                    <td>${detail.actualName || 'N/A'}</td>
                                    <td>${detail.actualSku || 'N/A'}</td>
                                    <td>${detail.expectedPos || 'N/A'}</td>
                                    <td>${detail.actualPos || 'N/A'}</td>
                                    <td class="status-mismatch">${detail.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                
                <div id="product-list-notMatch-${index}" class="product-list">
                    <h3>Not Match Products</h3>
                    <table class="product-table">
                        <thead>
                            <tr>
                                <th>Expected Product</th>
                                <th>Expected SKU</th>
                                <th>Actual Product</th>
                                <th>Actual SKU</th>
                                <th>Expected Position</th>
                                <th>Actual Position</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.details.filter(detail => detail.status.toLowerCase() === 'not match').map(detail => `
                                <tr>
                                    <td>${detail.expectedName || 'N/A'}</td>
                                    <td>${detail.expectedSku || 'N/A'}</td>
                                    <td>${detail.actualName || 'N/A'}</td>
                                    <td>${detail.actualSku || 'N/A'}</td>
                                    <td>${detail.expectedPos || 'N/A'}</td>
                                    <td>${detail.actualPos || 'N/A'}</td>
                                    <td class="status-not-match">${detail.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                
                <div id="product-list-firstPageCount-${index}" class="product-list">
                    <h3>First Page Products (${data.firstPageCount || 'N/A'})</h3>
                    <table class="product-table">
                        <thead>
                            <tr>
                                <th>Expected Product</th>
                                <th>Expected SKU</th>
                                <th>Actual Product</th>
                                <th>Actual SKU</th>
                                <th>Expected Position</th>
                                <th>Actual Position</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.details.filter(detail => {
                                if (!data.firstPageCount) return false;
                                const parts = data.firstPageCount.split(' of ');
                                if (parts.length !== 2) return false;
                                const firstPageFound = parseInt(parts[0]) || 0;
                                const actualPos = parseInt(detail.actualPos) || 0;
                                return actualPos > 0 && actualPos <= firstPageFound;
                            }).map(detail => `
                                <tr>
                                    <td>${detail.expectedName || 'N/A'}</td>
                                    <td>${detail.expectedSku || 'N/A'}</td>
                                    <td>${detail.actualName || 'N/A'}</td>
                                    <td>${detail.actualSku || 'N/A'}</td>
                                    <td>${detail.expectedPos || 'N/A'}</td>
                                    <td>${detail.actualPos || 'N/A'}</td>
                                    <td class="status-${detail.status.toLowerCase().replace(' ', '-')}">${detail.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                
            </div>
            `;
        }).join('')}
    </div>
    
    <script>
        // Chart data
        const queryData = ${JSON.stringify(queryGroups)};
        
        // Create summary chart
        const summaryCtx = document.getElementById('summaryChart').getContext('2d');
        const summaryData = {
            labels: Object.keys(queryData),
            datasets: [{
                label: 'Accuracy %',
                data: Object.values(queryData).map(d => parseFloat(d.accuracy)),
                backgroundColor: Object.values(queryData).map(d => {
                    const acc = parseFloat(d.accuracy);
                    if (acc >= 80) return 'rgba(75, 192, 192, 0.8)';
                    if (acc >= 50) return 'rgba(255, 206, 86, 0.8)';
                    return 'rgba(255, 99, 132, 0.8)';
                }),
                borderColor: Object.values(queryData).map(d => {
                    const acc = parseFloat(d.accuracy);
                    if (acc >= 80) return 'rgba(75, 192, 192, 1)';
                    if (acc >= 50) return 'rgba(255, 206, 86, 1)';
                    return 'rgba(255, 99, 132, 1)';
                }),
                borderWidth: 2
            }]
        };
        
        new Chart(summaryCtx, {
            type: 'bar',
            data: summaryData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'Accuracy: ' + context.parsed.y.toFixed(2) + '%';
                            }
                        }
                    }
                }
            }
        });
        
        
        // Create individual charts
        Object.values(queryData).forEach((data, index) => {
            const ctx = document.getElementById('chart-' + index).getContext('2d');
            
            const chartData = {
                labels: ['Matches', 'Mismatches', 'Not Match'],
                datasets: [{
                    data: [data.matches, data.mismatches, data.notMatch],
                    backgroundColor: [
                        'rgba(75, 192, 192, 0.8)',
                        'rgba(255, 99, 132, 0.8)',
                        'rgba(201, 203, 207, 0.8)'
                    ],
                    borderColor: [
                        'rgba(75, 192, 192, 1)',
                        'rgba(255, 99, 132, 1)',
                        'rgba(201, 203, 207, 1)'
                    ],
                    borderWidth: 2
                }]
            };
            
            new Chart(ctx, {
                type: 'doughnut',
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 15,
                                font: {
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return label + ': ' + value + ' (' + percentage + '%)';
                                }
                            }
                        }
                    }
                }
            });
        });
        
        // Add click handlers for stat cards
        document.addEventListener('DOMContentLoaded', function() {
            const statCards = document.querySelectorAll('.query-stat');
            
            statCards.forEach(card => {
                card.addEventListener('click', function() {
                    const category = this.getAttribute('data-category');
                    const queryIndex = this.getAttribute('data-query-index');
                    const productListId = \`product-list-\${category}-\${queryIndex}\`;
                    const productList = document.getElementById(productListId);
                    
                    // Hide all other product lists for this query
                    const allProductLists = document.querySelectorAll(\`[id^="product-list-"][id$="-\${queryIndex}"]\`);
                    allProductLists.forEach(list => {
                        if (list.id !== productListId) {
                            list.classList.remove('show');
                        }
                    });
                    
                    // Remove active state from all stat cards in this query
                    const queryStatCards = document.querySelectorAll(\`[data-query-index="\${queryIndex}"]\`);
                    queryStatCards.forEach(statCard => {
                        statCard.classList.remove('active');
                    });
                    
                    // Toggle the clicked product list
                    if (productList.classList.contains('show')) {
                        productList.classList.remove('show');
                        this.classList.remove('active');
                    } else {
                        productList.classList.add('show');
                        this.classList.add('active');
                        
                        // Smooth scroll to the product list
                        setTimeout(() => {
                            productList.scrollIntoView({ 
                                behavior: 'smooth', 
                                block: 'start' 
                            });
                        }, 100);
                    }
                });
            });
        });
        
        // Combined filter functionality for search and accuracy
        function applyFilters() {
            const searchTerm = document.getElementById('simpleQuerySearch').value.toLowerCase().trim();
            const accuracyFilter = document.getElementById('accuracyFilter').value;
            const querySections = document.querySelectorAll('.query-section');
            const filterInfo = document.getElementById('filterInfo');
            const clearAllBtn = document.getElementById('clearAllFiltersBtn');
            const clearSearchBtn = document.getElementById('clearSearchBtn');
            
            let visibleCount = 0;
            const totalCount = querySections.length;
            
            // Show/hide clear buttons
            if (searchTerm) {
                clearSearchBtn.style.display = 'block';
            } else {
                clearSearchBtn.style.display = 'none';
            }
            
            if (searchTerm || accuracyFilter !== 'all') {
                clearAllBtn.style.display = 'inline-block';
            } else {
                clearAllBtn.style.display = 'none';
            }
            
            // Filter query sections
            querySections.forEach(section => {
                let shouldShow = true;
                
                // Check search term
                if (searchTerm) {
                    const queryTitle = section.querySelector('.query-title');
                    if (queryTitle) {
                        const fullText = queryTitle.textContent;
                        const queryMatch = fullText.match(/Query: "(.+)"/);
                        const queryText = queryMatch ? queryMatch[1].toLowerCase() : fullText.toLowerCase();
                        
                        if (!queryText.includes(searchTerm)) {
                            shouldShow = false;
                        }
                    }
                }
                
                // Check accuracy filter
                if (shouldShow && accuracyFilter !== 'all') {
                    // Use data attribute for more reliable accuracy value
                    const accuracyValue = section.getAttribute('data-accuracy');
                    if (accuracyValue !== null) {
                        const accuracy = parseFloat(accuracyValue);
                        
                        switch(accuracyFilter) {
                            case '90-100':
                                shouldShow = accuracy >= 90 && accuracy <= 100;
                                break;
                            case '80-90':
                                shouldShow = accuracy >= 80 && accuracy < 90;
                                break;
                            case '70-80':
                                shouldShow = accuracy >= 70 && accuracy < 80;
                                break;
                            case '60-70':
                                shouldShow = accuracy >= 60 && accuracy < 70;
                                break;
                            case '50-60':
                                shouldShow = accuracy >= 50 && accuracy < 60;
                                break;
                            case '40-50':
                                shouldShow = accuracy >= 40 && accuracy < 50;
                                break;
                            case '30-40':
                                shouldShow = accuracy >= 30 && accuracy < 40;
                                break;
                            case '20-30':
                                shouldShow = accuracy >= 20 && accuracy < 30;
                                break;
                            case '10-20':
                                shouldShow = accuracy >= 10 && accuracy < 20;
                                break;
                            case '0-10':
                                shouldShow = accuracy >= 0 && accuracy < 10;
                                break;
                            default:
                                shouldShow = true;
                        }
                    }
                }
                
                // Show or hide section
                if (shouldShow) {
                    section.classList.remove('query-hidden');
                    visibleCount++;
                } else {
                    section.classList.add('query-hidden');
                }
            });
            
            // Update filter info
            let infoText = 'Showing ' + visibleCount + ' of ' + totalCount + ' queries';
            
            if (searchTerm && accuracyFilter !== 'all') {
                infoText += ' (filtered by search and accuracy)';
            } else if (searchTerm) {
                infoText += ' (filtered by search)';
            } else if (accuracyFilter !== 'all') {
                infoText += ' (filtered by accuracy)';
            } else {
                infoText = '';
            }
            
            filterInfo.textContent = infoText;
            
            // Auto-scroll to first visible result if filters are active
            if ((searchTerm || accuracyFilter !== 'all') && visibleCount > 0) {
                setTimeout(() => {
                    const firstVisible = document.querySelector('.query-section:not(.query-hidden)');
                    if (firstVisible) {
                        firstVisible.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 100);
            }
        }
        
        function clearSearchQuery() {
            document.getElementById('simpleQuerySearch').value = '';
            applyFilters();
            document.getElementById('simpleQuerySearch').focus();
        }
        
        function clearFilters() {
            document.getElementById('simpleQuerySearch').value = '';
            document.getElementById('accuracyFilter').value = 'all';
            applyFilters();
            document.getElementById('simpleQuerySearch').focus();
        }
        
        // Handle keyboard shortcuts
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('simpleQuerySearch');
            if (searchInput) {
                searchInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') {
                        clearFilters();
                    }
                });
            }
            
            // Apply initial filters in case of browser back/forward
            applyFilters();
        });
    </script>
</body>
</html>`;
        
        // Save HTML report
        const htmlPath = path.join(outputPath, `API_TEST_REPORT_${timestamp}.html`);
        fs.writeFileSync(htmlPath, html);
        
        return htmlPath;
    }

    /**
     * Check product presence from input list
     * @param {Array} inputProducts - Array of products to check (with name, sku properties)  
     * @param {string} csvContent - CSV content from position comparison
     * @returns {Object} - Simple report showing which products are present/missing
     */
    checkProductPresence(inputProducts, csvContent) {
        if (!inputProducts || !Array.isArray(inputProducts) || inputProducts.length === 0) {
            throw new Error('Input products array is required and must not be empty');
        }

        if (!csvContent || typeof csvContent !== 'string') {
            throw new Error('CSV content is required');
        }

        // Parse CSV data to get all actual products found
        const queryGroups = this.parseCSVData(csvContent);
        const allActualProducts = [];
        
        // Collect all actual products from all queries
        Object.values(queryGroups).forEach(group => {
            group.details.forEach(detail => {
                if (detail.actualName && detail.actualSku && detail.actualName !== 'No Product') {
                    allActualProducts.push({
                        name: detail.actualName,
                        sku: detail.actualSku
                    });
                }
            });
        });

        // Remove duplicates based on SKU
        const uniqueActualProducts = [];
        const seenSkus = new Set();
        allActualProducts.forEach(product => {
            if (product.sku && !seenSkus.has(product.sku.toLowerCase())) {
                seenSkus.add(product.sku.toLowerCase());
                uniqueActualProducts.push(product);
            }
        });

        let foundCount = 0;
        let missingCount = 0;

        // Check each input product
        inputProducts.forEach(inputProduct => {
            const inputSku = inputProduct.sku ? inputProduct.sku.toLowerCase().trim() : null;
            
            if (!inputSku) {
                missingCount++;
                return;
            }

            // Try to find by SKU
            const foundProduct = uniqueActualProducts.find(actual => 
                actual.sku && actual.sku.toLowerCase().trim() === inputSku
            );

            if (foundProduct) {
                foundCount++;
            } else {
                missingCount++;
            }
        });

        const foundPercentage = inputProducts.length > 0 
            ? ((foundCount / inputProducts.length) * 100).toFixed(2)
            : 0;

        return {
            totalInputProducts: inputProducts.length,
            totalFound: foundCount,
            totalMissing: missingCount,
            foundPercentage: foundPercentage,
            message: `Found ${foundCount} out of ${inputProducts.length} products (${foundPercentage}%)`
        };
    }
}

module.exports = ReportGeneratorClient;