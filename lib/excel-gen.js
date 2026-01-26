class ExcelGenerator {
    constructor() {
        // Ensure ExcelJS is loaded
        if (typeof ExcelJS === 'undefined') {
            console.error('ExcelJS library is missing');
        }
    }

    async generateExcel(items) {
        console.log('Generating Excel with items:', items);
        if (!window.TEMPLATE_DATA) {
            throw new Error("Template data not loaded. Please ensure lib/template-data.js is generated and linked.");
        }

        try {
            // 1. Load the template workbook
            console.log('Loading workbook...');
            const workbook = new ExcelJS.Workbook();
            const buffer = this.base64ToArrayBuffer(window.TEMPLATE_DATA);
            await workbook.xlsx.load(buffer);
            console.log('Workbook loaded');

            // 2. Get the specific sheet (Matches your CSV filename)
            const worksheet = workbook.getWorksheet('Change Request Form');
            if (!worksheet) {
                console.error('Worksheets available:', workbook.worksheets.map(ws => ws.name));
                throw new Error("Sheet 'Change Request Form' not found in the template.");
            }
            console.log('Worksheet found:', worksheet.name);

            // Helper to get text from cell (handles Rich Text)
            const getCellText = (cell) => {
                if (!cell || !cell.value) return '';
                if (cell.value.richText) {
                    return cell.value.richText.map(t => t.text).join('');
                }
                return cell.value.toString();
            };

            // 3. Find the starting row and Column Mapping
            let startRow = null;
            let colMap = {
                wrin: null,
                name: null,
                type: null,
                stock: null,
                reason: null
            };

            let foundAnchor = false;

            worksheet.eachRow((row, rowNumber) => {
                // 1. Look for the Blue Anchor text first (to skip the top example table)
                if (!foundAnchor) {
                    // Check string values in the row
                    const rowValues = row.values;
                    if (Array.isArray(rowValues)) {
                        const match = rowValues.some(val =>
                            val && val.toString().toLowerCase().includes('submit this form')
                        );
                        if (match) {
                            console.log('Found Anchor "Submit this form" at row:', rowNumber);
                            foundAnchor = true;
                        }
                    }
                    return; // Skip finding headers until we pass the anchor
                }

                // 2. Look for the Header Row (ONLY after finding anchor)
                // We want the first "WRIN" header we see AFTER the anchor
                if (foundAnchor && !startRow) {
                    let foundHeader = false;
                    row.eachCell((cell, colNumber) => {
                        const val = getCellText(cell).toUpperCase();
                        if (val.includes('WRIN')) {
                            colMap.wrin = colNumber;
                            foundHeader = true;
                        } else if (val.includes('DESCRIPTION')) {
                            colMap.name = colNumber;
                        } else if (val.includes('REDUCTION') || val.includes('TYPE')) {
                            colMap.type = colNumber;
                        } else if (val.includes('STOCK')) {
                            colMap.stock = colNumber;
                        } else if (val.includes('REASON')) {
                            colMap.reason = colNumber;
                        }
                    });

                    if (foundHeader) {
                        startRow = rowNumber + 1;
                        console.log('Found Target Header row at:', rowNumber);
                        console.log('Column Mapping AFTER Anchor:', colMap);
                    }
                }
            });

            // WORKAROUND: Remove conditional formatting to prevent ExcelJS save error
            // The error "Cannot read properties of undefined (reading '0')" in cf-rule-xform.js
            // is caused by incompatible conditional formatting rules in the template.
            if (worksheet.conditionalFormattings) {
                console.log('Removing conditional formatting rules:', worksheet.conditionalFormattings.length);
                worksheet.conditionalFormattings = [];
            } else {
                console.log('No conditional formatting found on worksheet object, checking different property...');
                // sometimes it might be just 'conditionalFormatting' depending on version, checking both
                if (worksheet.conditionalFormatting) {
                    worksheet.conditionalFormatting = [];
                }
            }

            if (!startRow) {
                // Should not happen if the template matches the screenshot
                console.error('Critical: Target table not found after anchor!');
                // Fallback to manual B32 idea if detection fails?
                // User mentioned B32 -> Row 32? Column 2?
                // Examples are usually higher up. 
                startRow = 32;
                colMap = { wrin: 2, name: 3, type: 4, stock: 5, reason: 6 }; // Assuming starts at B
                console.log('Using fallback startRow:', startRow, colMap);
            }

            // Fill partial mapping gaps if necessary
            // If we have WRIN, assume standard layout sequential
            if (colMap.wrin) {
                if (!colMap.name) colMap.name = colMap.wrin + 1;
                if (!colMap.type) colMap.type = colMap.wrin + 2;
                if (!colMap.stock) colMap.stock = colMap.wrin + 3;
                if (!colMap.reason) colMap.reason = colMap.wrin + 4;
            } else {
                if (!colMap.wrin) colMap.wrin = 1;
                if (!colMap.name) colMap.name = 2;
                if (!colMap.type) colMap.type = 3;
                if (!colMap.stock) colMap.stock = 4;
                if (!colMap.reason) colMap.reason = 5;
            }
            console.log('Final Column Mapping:', colMap);

            // CLEANUP: Clear rows
            // We need to commit the cleared rows to effectively remove them before writing
            console.log('Clearing 100 rows starting from:', startRow);
            for (let i = 0; i < 100; i++) {
                const row = worksheet.getRow(startRow + i);
                if (row) {
                    for (let col = 1; col <= 10; col++) {
                        row.getCell(col).value = null;
                    }
                    row.commit();
                }
            }

            // 4. Write the data
            console.log('Writing data starting at row:', startRow);
            items.forEach((item, index) => {
                const currentRow = startRow + index;
                // Since we committed the cleared rows, getRow creates a new clean row
                const row = worksheet.getRow(currentRow);

                console.log(`Writing row ${currentRow}:`, item);

                // Use Dynamic Mapping
                if (colMap.wrin) row.getCell(colMap.wrin).value = parseInt(item.wrin) || item.wrin;
                if (colMap.name) row.getCell(colMap.name).value = item.name || '';

                const type = item.status === 'increase' ? 'Increase' :
                    item.status === 'decrease' ? 'Decrease' : item.status;
                if (colMap.type) row.getCell(colMap.type).value = type;

                if (colMap.stock) row.getCell(colMap.stock).value = parseFloat(item.actualStock);

                if (colMap.reason) row.getCell(colMap.reason).value = item.reason || '';

                // Do NOT commit here to allow save to work properly
            });
            console.log('Data written successfully');

            return workbook;
        } catch (error) {
            console.error('Error inside generateExcel:', error);
            throw error;
        }
    }

    async downloadExcel(workbook) {
        try {
            console.log('Inside downloadExcel');
            // Generate filename with date
            const date = new Date().toISOString().split('T')[0];
            const fileName = `MB_Change_Request_${date}.xlsx`;

            // Write to buffer and trigger download
            console.log('Writing buffer...');
            const buffer = await workbook.xlsx.writeBuffer();
            console.log('Buffer written, size:', buffer.byteLength);

            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            console.log('Blob created');

            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName;
            anchor.click();

            window.URL.revokeObjectURL(url);
            console.log('Download triggered');
        } catch (e) {
            console.error('Error in downloadExcel:', e);
            throw e;
        }
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