class PDFParser {
    constructor() {
        this.items = [];
    }

    async parsePDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const allTextLines = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();

                const items = textContent.items;
                items.sort((a, b) => {
                    const yDiff = b.transform[5] - a.transform[5];
                    if (Math.abs(yDiff) > 5) return yDiff;
                    return a.transform[4] - b.transform[4];
                });

                let currentY = null;
                let currentLineStr = "";
                let lastXWithWidth = 0;

                for (const item of items) {
                    const x = item.transform[4];
                    const y = item.transform[5];
                    const text = item.str;

                    if (!text.trim()) continue;

                    if (currentY === null || Math.abs(y - currentY) > 5) {
                        if (currentLineStr.trim()) allTextLines.push(currentLineStr.trim());
                        currentLineStr = text;
                        currentY = y;
                        lastXWithWidth = x + item.width;
                    } else {
                        const gap = x - lastXWithWidth;
                        if (gap > 4) {
                            currentLineStr += " " + text;
                        } else {
                            currentLineStr += text;
                        }
                        lastXWithWidth = x + item.width;
                    }
                }
                if (currentLineStr.trim()) allTextLines.push(currentLineStr.trim());
            }

            console.log('--- PDF RAW TEXT DUMP ---');
            console.log(allTextLines.join('\n'));
            console.log('-------------------------');

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
            if (/store\s*#|page\s*\d|report|user:|date:|time:|^processed/i.test(line)) continue;
            if (/^WRIN\s+Description/i.test(line)) continue;

            const tokens = line.trim().split(/\s+/);
            if (tokens.length < 3) continue;

            const wrinMatch = tokens[0].match(/^(\d{4,8})$/);
            if (!wrinMatch) continue;
            const wrin = wrinMatch[1];

            let storageType = 'Unknown';
            let endIndex = tokens.length - 1;
            const lastToken = tokens[endIndex];

            const cleanLastToken = lastToken.replace(/[-,–]/g, '');
            const isNumber = /^[\d]+(\.\d+)?$/.test(cleanLastToken) || lastToken === '-' || lastToken === '–';

            if (!isNumber && lastToken.length > 1) {
                storageType = lastToken;
                const matchedKey = storageKeywords.find(k => lastToken.toLowerCase().includes(k.toLowerCase()));
                if (matchedKey) {
                    storageType = matchedKey === 'ManualItems' ? 'Manual Items' : matchedKey;
                }

                endIndex--;
            }

            let dataTokens = [];
            let dataStartIndex = endIndex + 1;

            let columnsFound = 0;

            for (let i = endIndex; i > 0; i--) {
                const t = tokens[i];
                // Sanitize: remove pretty much everything that isn't a digit, dot, or some form of dash
                // We strip all variants of dashes from the *checked* string to see if it's a number
                const cleanT = t.replace(/[^\d\.]/g, '');

                // Check if the ORIGINAL token was just a dash (of any kind)
                // Includes standard hyphen, en-dash, em-dash, and unicode minus sign
                const isDash = /^[-\u2013\u2014\u2212]+$/.test(t);

                // CRITICAL FIX: If the token has letters (e.g., "x6", "sd25"), it is part of the NAME.
                const hasLetters = /[a-zA-Z]/.test(t);

                // If it cleans down to a number, or it is a dash, AND it has no letters
                if (((/^[\d]+(\.\d+)?$/.test(cleanT) && cleanT.length > 0) || isDash) && !hasLetters) {
                    if (columnsFound < 7) {
                        dataTokens.unshift(cleanT);
                        columnsFound++;
                        dataStartIndex = i;
                    } else {
                        break;
                    }
                } else {
                    if (columnsFound === 0) {
                        // Keep going if we haven't found data yet
                    } else {
                        break;
                    }
                }
            }

            const nameTokens = tokens.slice(1, dataStartIndex);
            let name = nameTokens.join(' ');

            // NEW STRATEGY: Regex Pattern Matching
            // We want to find the LAST 3-4 significant numbers in the line.
            // Typical line: WRIN Name ... Prop [?] Stock Transit ...

            // Join tokens back into a string to use regex
            const fullLine = line.trim();

            // Regex to find the last chunk of numbers.
            // We look for a sequence of numbers (integers or decimals) at the end of the line.
            // We allow spaces between them.
            // We capture the last few numbers.

            let proposedQty = 0;
            let rsp = 0;
            let transit = 0;

            // Filter tokens to just be things that look like numbers (or dashes)
            // leveraging the robust cleaning we already did
            let numericTokens = dataTokens.map(t => {
                if (/^[-\u2013\u2014\u2212]+$/.test(t)) return 0;
                return parseFloat(t) || 0;
            });

            // Constraint Check 1: Proposed Qty (Index 0) NEVER has a decimal.
            // If the first number is a decimal (e.g. "23.1"), it's likely part of the Name (e.g. "sd 23.1").
            if (numericTokens.length > 0 && numericTokens[0] % 1 !== 0) {
                numericTokens.shift(); // Remove it, treating it as invalid data
            }

            const cnt = numericTokens.length;

            if (cnt >= 3) {
                // Standard & Sparse Logic (Unified)
                // Left-Aligned Indexing based on fixed column order: [Prop] [Order] [RSP] [Stock] [Transit]

                // Index 0: Proposed Qty
                proposedQty = numericTokens[0];

                // Index 2: RSP (Price) - This CAN have decimals
                if (cnt > 2) rsp = numericTokens[2];

                // Index 4: In Transit
                // Constraint Check 2: Transit NEVER has a decimal.
                if (cnt > 4) {
                    const candidateTransit = numericTokens[4];
                    if (candidateTransit % 1 !== 0) {
                        // If it's a decimal, it's NOT Transit (likely Usage/Cycle Stock).
                        // Transit is likely missing or 0.
                        transit = 0;
                    } else {
                        transit = candidateTransit;
                    }
                }
            } else {
                // Fallback for very broken lines (1 or 2 numbers)
                if (cnt >= 1) proposedQty = numericTokens[0];
                if (cnt >= 2) rsp = numericTokens[1]; // Might be Order or RSP
            }

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
        return this.items.filter(item =>
            item.status === 'increase' || item.status === 'decrease'
        );
    }

    getExportItems() {
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
