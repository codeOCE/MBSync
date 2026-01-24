class ExcelGenerator {
    constructor() {
        // Ensure ExcelJS is loaded
        if (typeof ExcelJS === 'undefined') {
            console.error('ExcelJS library is missing');
        }
    }

    async generateExcel(items) {
        if (!window.TEMPLATE_DATA) {
            throw new Error("Template data not loaded. Please ensure lib/template-data.js is generated and linked.");
        }

        // 1. Load the template workbook
        const workbook = new ExcelJS.Workbook();
        const buffer = this.base64ToArrayBuffer(window.TEMPLATE_DATA);
        await workbook.xlsx.load(buffer);

        // 2. Get the specific sheet (Matches your CSV filename)
        const worksheet = workbook.getWorksheet('Change Request Form');
        if (!worksheet) {
            throw new Error("Sheet 'Change Request Form' not found in the template.");
        }

        // 3. Find the starting row
        // We look for the header "WRIN NUMBER" to know where to start writing
        let startRow = null;
        worksheet.eachRow((row, rowNumber) => {
            // Check specific cells for the header markers based on your CSV
            const cellA = row.getCell(1).value; // Column A
            if (cellA && cellA.toString().toUpperCase().includes('WRIN NUMBER')) {
                startRow = rowNumber + 1; // Start writing on the next row
            }
        });

        if (!startRow) {
            // Fallback if header not found, based on your CSV structure usually around row 32
            startRow = 32;
        }

        // 4. Write the data
        items.forEach((item, index) => {
            const currentRow = startRow + index;
            const row = worksheet.getRow(currentRow);

            // Column Mapping based on your CSV structure:
            // A: WRIN NUMBER
            // B: DESCRIPTION
            // D: Reduction Type (Increase/Decrease)
            // E: Stock On Hand
            // F: Reason for Change

            row.getCell(1).value = parseInt(item.wrin) || item.wrin; // Col A
            row.getCell(2).value = item.name || '';                  // Col B

            // Map status to "Increase" or "Decrease" (Capitalized)
            const type = item.status === 'increase' ? 'Increase' :
                item.status === 'decrease' ? 'Decrease' : item.status;
            row.getCell(4).value = type;                             // Col D

            row.getCell(5).value = parseFloat(item.actualStock);     // Col E
            row.getCell(6).value = item.reason || '';                // Col F

            // Commit the row updates
            row.commit();
        });

        return workbook;
    }

    async downloadExcel(workbook) {
        // Generate filename with date
        const date = new Date().toISOString().split('T')[0];
        const fileName = `MB_Change_Request_${date}.xlsx`;

        // Write to buffer and trigger download
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();

        window.URL.revokeObjectURL(url);
    }

    // Helper to convert Base64 string to ArrayBuffer
    base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}