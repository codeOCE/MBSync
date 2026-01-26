class ExcelGenerator {
    constructor() {
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
            console.log('Loading workbook...');
            const workbook = new ExcelJS.Workbook();
            const buffer = this.base64ToArrayBuffer(window.TEMPLATE_DATA);
            await workbook.xlsx.load(buffer);
            console.log('Workbook loaded');

            const worksheet = workbook.getWorksheet('Change Request Form');
            if (!worksheet) {
                console.error('Worksheets available:', workbook.worksheets.map(ws => ws.name));
                throw new Error("Sheet 'Change Request Form' not found in the template.");
            }
            console.log('Worksheet found:', worksheet.name);

            const getCellText = (cell) => {
                if (!cell || !cell.value) return '';
                if (cell.value.richText) {
                    return cell.value.richText.map(t => t.text).join('');
                }
                return cell.value.toString();
            };

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
                if (!foundAnchor) {
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
                    return;
                }

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

            if (worksheet.conditionalFormattings) {
                console.log('Removing conditional formatting rules:', worksheet.conditionalFormattings.length);
                worksheet.conditionalFormattings = [];
            } else {
                console.log('No conditional formatting found on worksheet object, checking different property...');
                if (worksheet.conditionalFormatting) {
                    worksheet.conditionalFormatting = [];
                }
            }

            if (!startRow) {
                console.error('Critical: Target table not found after anchor!');
                startRow = 32;
                colMap = { wrin: 2, name: 3, type: 4, stock: 5, reason: 6 };
                console.log('Using fallback startRow:', startRow, colMap);
            }

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

            console.log('Writing data starting at row:', startRow);
            items.forEach((item, index) => {
                const currentRow = startRow + index;
                const row = worksheet.getRow(currentRow);

                console.log(`Writing row ${currentRow}:`, item);

                if (colMap.wrin) row.getCell(colMap.wrin).value = parseInt(item.wrin) || item.wrin;
                if (colMap.name) row.getCell(colMap.name).value = item.name || '';

                const type = item.status === 'increase' ? 'Increase' :
                    item.status === 'decrease' ? 'Decrease' : item.status;
                if (colMap.type) row.getCell(colMap.type).value = type;

                if (colMap.stock) row.getCell(colMap.stock).value = parseFloat(item.actualStock);

                if (colMap.reason) row.getCell(colMap.reason).value = item.reason || '';

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
            const date = new Date().toISOString().split('T')[0];
            const fileName = `MB_Change_Request_${date}.xlsx`;

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