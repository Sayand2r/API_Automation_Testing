const fs = require('fs');
const ReportGeneratorClient = require('./report-generator-client');

// Test the report generator with the accuracy filter
async function testReportGenerator() {
    const csvPath = 'Output Reports/POSITION_COMPARISON_2025-09-08_19-21-58.csv';
    
    if (!fs.existsSync(csvPath)) {
        console.error('CSV file not found:', csvPath);
        return;
    }
    
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const generator = new ReportGeneratorClient();
    
    try {
        const reportPath = await generator.generateHTMLReport(csvContent, 'Output Reports');
        console.log('Report generated successfully:', reportPath);
        console.log('Open the report in a browser to test the accuracy filter functionality.');
    } catch (error) {
        console.error('Error generating report:', error);
    }
}

testReportGenerator();