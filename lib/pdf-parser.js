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
                // Sanitize: remove commas and ALL types of dashes
                const cleanT = t.replace(/[-,–—]/g, '');

                // Allow if it looks like a number, or was a placeholder dash (check all dash types)
                const isDash = t === '-' || t === '–' || t === '—';

                if ((/^[\d]+(\.\d+)?$/.test(cleanT) && cleanT.length > 0) || isDash) {
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

            const dCount = dataTokens.length;

            let proposedQty = 0;
            let rsp = 0;
            let transit = 0;

            // Adjusted logic to support 6 columns (often missing Variance Cost?)
            if (dCount >= 7) {
                proposedQty = parseFloat(dataTokens[dCount - 7]) || 0;
                rsp = parseFloat(dataTokens[dCount - 5]) || 0;
                transit = parseFloat(dataTokens[dCount - 4]) || 0;
            } else if (dCount === 6) {
                // If 6 cols: Prop, Stock, Transit, Usage, Closing, Var
                proposedQty = parseFloat(dataTokens[0]) || 0;
                rsp = parseFloat(dataTokens[1]) || 0;
                transit = parseFloat(dataTokens[2]) || 0;
            } else {
                // Fallback for 5 or fewer (partial data)
                if (dCount >= 5) rsp = parseFloat(dataTokens[dCount - 5]) || 0;
                if (dCount >= 4) transit = parseFloat(dataTokens[dCount - 4]) || 0;
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
