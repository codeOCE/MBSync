// PDF Parser Module - Text Layout Strategy
// Reconstructs visual lines and parses via Regex
// Mimics 'pdftotext -layout' behavior for robustness

class PDFParser {
    constructor() {
        this.items = [];
    }

    async parsePDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const allTextLines = [];

            // 1. Reconstruct Text Lines from Geometry
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();

                // Sort items: Top to Bottom (Y desc), then Left to Right (X asc)
                const items = textContent.items;
                items.sort((a, b) => {
                    const yDiff = b.transform[5] - a.transform[5]; // Y is 5th element
                    if (Math.abs(yDiff) > 5) return yDiff; // Different lines
                    return a.transform[4] - b.transform[4]; // Same line, sort X
                });

                // Build Lines
                let currentY = null;
                let currentLineStr = "";
                let lastXWithWidth = 0;

                for (const item of items) {
                    const x = item.transform[4];
                    const y = item.transform[5];
                    const text = item.str;

                    if (!text.trim()) continue; // Skip pure whitespace tokens (we add our own spaces)

                    // Check for new line (vertical jump > 5 units)
                    if (currentY === null || Math.abs(y - currentY) > 5) {
                        if (currentLineStr.trim()) allTextLines.push(currentLineStr.trim());
                        currentLineStr = text;
                        currentY = y;
                        lastXWithWidth = x + item.width;
                    } else {
                        // Same line - calculate gap for spaces
                        const gap = x - lastXWithWidth;
                        // If gap is significant (e.g. > 4 units), add a space. 
                        // Visual spacing often > 10 for column separation.
                        if (gap > 4) {
                            currentLineStr += " " + text;
                        } else {
                            currentLineStr += text; // Merge close tokens (e.g. part of same word)
                        }
                        lastXWithWidth = x + item.width;
                    }
                }
                // Push last line of page
                if (currentLineStr.trim()) allTextLines.push(currentLineStr.trim());
            }

            // DEBUG: Log the full reconstructed text to console
            console.log('--- PDF RAW TEXT DUMP ---');
            console.log(allTextLines.join('\n'));
            console.log('-------------------------');

            // 2. Parse the Reconstructed Lines
            this.items = this.parseTextLines(allTextLines);
            return this.items;

        } catch (error) {
            console.error('PDF parsing error:', error);
            throw new Error('Failed to parse PDF. Please ensure it is a valid MB Sync report.');
        }
    }

    parseTextLines(lines) {
        const items = [];
        const storageKeywords = ['Refrigerated', 'Frozen', 'Dry', 'ManualItems'];

        for (const line of lines) {
            // A. Skip Known Headers
            if (/store\s*#|page\s*\d|report|user:|date:|time:|^processed/i.test(line)) continue;
            if (/^WRIN\s+Description/i.test(line)) continue;

            // Tokenize by whitespace
            const tokens = line.trim().split(/\s+/);
            if (tokens.length < 3) continue;

            // 1. WRIN: First token
            const wrinMatch = tokens[0].match(/^(\d{4,8})$/);
            if (!wrinMatch) continue;
            const wrin = wrinMatch[1];

            // 2. Storage Tag: Check Last Token
            let storageType = 'Unknown';
            let endIndex = tokens.length - 1;
            const lastToken = tokens[endIndex];

            // Check if last token is a storage keyword OR if user says "last text is tag"
            // We check if it matches known keywords or is non-numeric text
            const isNumber = /^-?[\d,]+(\.\d+)?$/.test(lastToken.replace(/,/g, ''));

            if (!isNumber && lastToken.length > 1) {
                // It's text, likely the tag
                storageType = lastToken;
                // Normalize if it matches known key
                const matchedKey = storageKeywords.find(k => lastToken.toLowerCase().includes(k.toLowerCase()));
                if (matchedKey) {
                    // Force space for Manual Items
                    storageType = matchedKey === 'ManualItems' ? 'Manual Items' : matchedKey;
                }

                endIndex--; // Move boundary back
            }

            // 3. Data Columns (Expect up to 7 numbers)
            // We scan backwards from endIndex for numbers
            let dataTokens = [];
            let dataStartIndex = endIndex + 1; // Start after the valid data range

            let columnsFound = 0;
            // We need columns 1 to 7 (or however many exist). 
            // Mapping:
            // Col 1 (Rightmost): Proposed Qty (7th Last logic? No, mapping is fixed slots)
            // Let's stick to the 7-slot logic.
            // Scan backwards for up to 7 valid numbers.
            // If we hit an 8th number, STOP. It belongs to Name.

            for (let i = endIndex; i > 0; i--) {
                const t = tokens[i];
                if (/^-?[\d,]+(\.\d+)?$/.test(t.replace(/,/g, ''))) {
                    // It is a number
                    if (columnsFound < 7) {
                        dataTokens.unshift(t.replace(/,/g, '')); // Add to front of data array
                        columnsFound++;
                        dataStartIndex = i;
                    } else {
                        // We found 7 columns already. The 8th number belongs to Name.
                        break;
                    }
                } else {
                    // Non-number found in data zone? 
                    // If we haven't found items yet, it might be a weird unit "EA".
                    // But user said "8th last number should be included in name".
                    // Let's assume data block is contiguous numbers.
                    if (columnsFound === 0) {
                        // Maybe another piece of tag?
                        // Ignore for now, or add to tag?
                    } else {
                        // Found text between numbers? Break data collection?
                        break;
                    }
                }
            }

            // 4. Name: Everything from tokens[1] to tokens[dataStartIndex - 1]
            const nameTokens = tokens.slice(1, dataStartIndex);
            let name = nameTokens.join(' ');

            // 5. Map Data
            // We have `dataTokens` array of length 0 to 7.
            // Map Right-to-Left based on array length
            const dCount = dataTokens.length;

            // User Mapping:
            // 7. Proposed (Rightmost? No "7th last" implies order)
            // Standard order: [ ... , RSP, Transit, ... , Proposed ]

            // Re-reading user request: "7th Last = Proposed Qty"
            // Wait, "7th Last" implies it's the first one if we count 7 columns.
            // Let's assume the order is:
            // [Col7, Col6, Col5, Col4, Col3, Col2, Col1]
            // User: "4th Last = Transit", "5th Last = RSP", "7th Last = Proposed Qty"

            // If dCount == 7:
            // index 0 = Proposed Qty (7th from end)
            // index 1 = Order Qty (6th from end)
            // index 2 = RSP (5th from end)
            // index 3 = Transit (4th from end)
            // index 4 = Cycle (3rd from end)
            // index 5 = Stock Left (2nd from end)
            // index 6 = Safety Stock (Last)

            let proposedQty = 0;
            let rsp = 0;
            let transit = 0;

            if (dCount >= 7) proposedQty = parseFloat(dataTokens[dCount - 7]) || 0;
            if (dCount >= 5) rsp = parseFloat(dataTokens[dCount - 5]) || 0;
            if (dCount >= 4) transit = parseFloat(dataTokens[dCount - 4]) || 0;

            // Fallback: If only 6 columns found?
            // "6th Last = Order Qty". "7th Last = Proposed".
            // If only 6 nums, Proposed is missing? Or shifted?
            // Usually MB Sync removes empty columns. 
            // Valid assumption: Columns are fixed position if present.
            // But if user says "7th Last is Proposed", they assume 7 columns exist.

            items.push({
                wrin,
                name: this.cleanName(name),
                proposedQty,
                stock: rsp,
                transit,
                storageType,
                status: 'neutral',
                actualStock: null,
                adjustedQty: proposedQty,
                reason: ''
            });
        }
        return items;
    }

    cleanName(name) {
        return name
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    getItems() {
        return this.items;
    }

    updateItemStatus(wrin, status, actualStock = null, reason = null) {
        const item = this.items.find(i => i.wrin === wrin);
        if (item) {
            item.status = status;
            item.actualStock = actualStock;
            item.reason = reason;

            if (status === 'increase' && actualStock !== null) {
                const diff = item.stock - actualStock;
                item.adjustedQty = Math.max(0, item.proposedQty + diff);
            } else if (status === 'decrease' && actualStock !== null) {
                const diff = actualStock - item.stock;
                item.adjustedQty = Math.max(0, item.proposedQty - diff);
            } else if (status === 'accept') {
                item.adjustedQty = item.proposedQty;
            }
        }
    }

    getAdjustedItems() {
        // Only explicitly changed items
        return this.items.filter(item =>
            item.status === 'increase' || item.status === 'decrease'
        );
    }

    getExportItems() {
        // Return all items, mapping neutral -> accept
        return this.items.map(item => ({
            ...item,
            status: item.status === 'neutral' ? 'accept' : item.status
        }));
    }

    getStats() {
        return {
            total: this.items.length,
            accept: this.items.filter(i => i.status === 'accept' || i.status === 'neutral').length,
            increase: this.items.filter(i => i.status === 'increase').length,
            decrease: this.items.filter(i => i.status === 'decrease').length
        };
    }
}
