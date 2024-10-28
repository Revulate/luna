import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ProfileData {
    timestamps: number[];
    durations: number[];
    functionCalls: {
        name: string;
        count: number;
        totalTime: number;
        avgTime: number;
    }[];
    memoryUsage: {
        timestamp: number;
        heapUsed: number;
        heapTotal: number;
        external: number;
    }[];
}

async function processProfile(inputPath: string): Promise<ProfileData> {
    try {
        const data = await readFile(inputPath, 'utf8');
        const lines = data.split('\n').filter(line => line.trim());

        const profile: ProfileData = {
            timestamps: [],
            durations: [],
            functionCalls: [],
            memoryUsage: []
        };

        const functionStats = new Map<string, { count: number; totalTime: number }>();

        for (const line of lines) {
            const entry = JSON.parse(line);

            if (entry.type === 'function') {
                const stats = functionStats.get(entry.name) || { count: 0, totalTime: 0 };
                stats.count++;
                stats.totalTime += entry.duration;
                functionStats.set(entry.name, stats);

                profile.timestamps.push(entry.timestamp);
                profile.durations.push(entry.duration);
            }

            if (entry.type === 'memory') {
                profile.memoryUsage.push({
                    timestamp: entry.timestamp,
                    heapUsed: entry.heapUsed,
                    heapTotal: entry.heapTotal,
                    external: entry.external
                });
            }
        }

        // Process function stats
        profile.functionCalls = Array.from(functionStats.entries())
            .map(([name, stats]) => ({
                name,
                count: stats.count,
                totalTime: stats.totalTime,
                avgTime: stats.totalTime / stats.count
            }))
            .sort((a, b) => b.totalTime - a.totalTime);

        return profile;

    } catch (error) {
        console.error('Error processing profile:', error);
        throw error;
    }
}

async function generateReport(profile: ProfileData, outputPath: string): Promise<void> {
    try {
        const report = [
            '# Performance Profile Report',
            '',
            '## Overview',
            `- Total function calls: ${profile.timestamps.length}`,
            `- Total unique functions: ${profile.functionCalls.length}`,
            `- Total execution time: ${profile.durations.reduce((a, b) => a + b, 0)}ms`,
            '',
            '## Top Functions by Total Time',
            '',
            '| Function | Calls | Total Time (ms) | Avg Time (ms) |',
            '|----------|-------|----------------|---------------|',
            ...profile.functionCalls
                .slice(0, 20)
                .map(fn => 
                    `| ${fn.name} | ${fn.count} | ${fn.totalTime.toFixed(2)} | ${fn.avgTime.toFixed(2)} |`
                ),
            '',
            '## Memory Usage',
            '',
            '| Timestamp | Heap Used (MB) | Heap Total (MB) | External (MB) |',
            '|-----------|----------------|-----------------|---------------|',
            ...profile.memoryUsage
                .map(mem => 
                    `| ${new Date(mem.timestamp).toISOString()} | ` +
                    `${(mem.heapUsed / 1024 / 1024).toFixed(2)} | ` +
                    `${(mem.heapTotal / 1024 / 1024).toFixed(2)} | ` +
                    `${(mem.external / 1024 / 1024).toFixed(2)} |`
                )
        ].join('\n');

        await writeFile(outputPath, report);
        console.log(`Report generated: ${outputPath}`);

    } catch (error) {
        console.error('Error generating report:', error);
        throw error;
    }
}

// Export for use in other files
export { processProfile, generateReport };

// Allow running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const inputPath = process.argv[2];
    const outputPath = process.argv[3] || 'profile-report.md';

    if (!inputPath) {
        console.error('Usage: node process-profile.js <input-file> [output-file]');
        process.exit(1);
    }

    processProfile(inputPath)
        .then(profile => generateReport(profile, outputPath))
        .then(() => console.log('Profile processing complete'))
        .catch(error => {
            console.error('Profile processing failed:', error);
            process.exit(1);
        });
}
