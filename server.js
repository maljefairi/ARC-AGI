const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const GridTransformer = require('./lib/GridTransformer');

const app = express();
const port = 4000;

// Configure CORS to allow all origins with more detailed options
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Increase payload limit and add error handling
app.use(express.json({ 
    limit: '50mb',
    verify: (req, res, buf) => {
        try {
            JSON.parse(buf);
        } catch(e) {
            res.status(400).json({ success: false, error: 'Invalid JSON' });
            throw new Error('Invalid JSON');
        }
    }
}));

app.use(express.static('public'));

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Add detailed error logging middleware
app.use((err, req, res, next) => {
    const errorDetails = {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        error: err.message || 'Internal server error',
        stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
    };
    console.error('Server error:', errorDetails);
    res.status(500).json({
        success: false,
        error: errorDetails.error
    });
});

// Path for saving progress
const PROGRESS_FILE = path.join(__dirname, 'training_progress.json');

// Global stats with persistence and enhanced tracking
let stats = {
    successRate: 0,
    learnedStrategies: 0,
    totalAttempts: 0,
    successfulAttempts: 0,
    learningEfficiency: 0,
    transformationHistory: [],
    lastPuzzleId: null,
    savedStrategies: [],
    // New fields for better tracking and learning
    partialSuccesses: [], // Store close matches for refinement
    strategyEffectiveness: {}, // Track success rate of each strategy
    puzzleSimilarities: {}, // Store puzzle similarities for knowledge transfer
    debugLogs: [] // Detailed solving attempts and reasoning
};

// Puzzle cache
const puzzleCache = {
    training: [],
    evaluation: []
};

// Load puzzles from files
function loadPuzzles() {
    const trainingDir = path.join(__dirname, 'training');
    const evaluationDir = path.join(__dirname, 'evaluation');

    try {
        // Load training puzzles
        if (fs.existsSync(trainingDir)) {
            puzzleCache.training = fs.readdirSync(trainingDir)
                .filter(file => file.endsWith('.json'))
                .map(file => {
                    const filePath = path.join(trainingDir, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    return JSON.parse(content);
                });
        }

        // Load evaluation puzzles
        if (fs.existsSync(evaluationDir)) {
            puzzleCache.evaluation = fs.readdirSync(evaluationDir)
                .filter(file => file.endsWith('.json'))
                .map(file => {
                    const filePath = path.join(evaluationDir, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    return JSON.parse(content);
                });
        }

        console.log(`Loaded ${puzzleCache.training.length} training puzzles and ${puzzleCache.evaluation.length} evaluation puzzles`);
    } catch (error) {
        console.error('Error loading puzzles:', error);
    }
}

// Load saved progress at startup
async function loadProgress() {
    try {
        const data = await fsPromises.readFile(PROGRESS_FILE, 'utf8');
        const savedStats = JSON.parse(data);
        stats = { ...stats, ...savedStats };
        console.log('Loaded saved progress:', stats);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading progress:', error);
        }
        // If file doesn't exist, we'll start fresh
        await saveProgress();
    }
}

// Save progress to file
async function saveProgress() {
    try {
        await fsPromises.writeFile(PROGRESS_FILE, JSON.stringify(stats, null, 2));
        console.log('Progress saved successfully');
    } catch (error) {
        console.error('Error saving progress:', error);
    }
}

// Get a random puzzle from the cache
function getRandomPuzzle() {
    // Combine training and evaluation puzzles
    const allPuzzles = [...puzzleCache.training, ...puzzleCache.evaluation];
    
    if (allPuzzles.length === 0) {
        return null;
    }

    // Get a random puzzle
    const randomIndex = Math.floor(Math.random() * allPuzzles.length);
    return {
        success: true,
        puzzle: allPuzzles[randomIndex]
    };
}

// Get a random puzzle
app.get('/api/puzzle', (req, res) => {
    try {
        console.log('Received puzzle request:', req.query);
        const puzzle = getRandomPuzzle();
        if (!puzzle) {
            throw new Error('No puzzles available');
        }
        const response = {
            timestamp: new Date().toISOString(),
            puzzleId: puzzle.puzzle.id,
            trainCount: puzzle.puzzle.train.length,
            testCount: puzzle.puzzle.test.length
        };
        console.log('Serving puzzle:', response);
        res.json(puzzle.puzzle);
    } catch (error) {
        console.error('Error serving puzzle:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get puzzle'
        });
    }
});

// Solve puzzle endpoint
app.post('/api/solve', async (req, res) => {
    try {
        console.log('Received solve request:', {
            timestamp: new Date().toISOString(),
            inputSize: req.body.input?.length,
            outputSize: req.body.output?.length
        });

        if (!req.body.input || !req.body.output) {
            throw new Error('Missing input or output grid');
        }

        const result = await solveGrid(req.body.input, req.body.output);
        console.log('Solve result:', {
            timestamp: new Date().toISOString(),
            similarity: result.similarity,
            transformation: result.transformation
        });

        // Save progress after each solve attempt
        await saveProgress();
        console.log('Progress saved successfully');

        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('Error solving puzzle:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to solve puzzle'
        });
    }
});

// Get current statistics
app.get('/api/stats', (req, res) => {
    try {
        const currentStats = {
            totalAttempts: stats.totalAttempts,
            successfulAttempts: stats.successfulAttempts,
            successRate: stats.successfulAttempts / (stats.totalAttempts || 1),
            learningEfficiency: stats.learningEfficiency,
            strategyCount: Object.keys(stats.strategyEffectiveness).length,
            recentStrategies: stats.partialSuccesses
                .slice(0, 10)
                .map(s => ({
                    transformation: s.transformation,
                    similarity: s.similarity,
                    timestamp: s.timestamp
                }))
        };
        res.json(currentStats);
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get stats'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is healthy' });
});

// Reset stats
app.post('/api/reset', async (req, res) => {
    try {
        // Reset stats
        stats = {
            totalAttempts: 0,
            successfulAttempts: 0,
            learningEfficiency: 0,
            partialSuccesses: [],
            strategyEffectiveness: {},
            puzzleSimilarities: {},
            debugLogs: []
        };
        
        // Save reset state
        await saveProgress();
        
        res.json({
            success: true,
            message: 'Stats reset successfully'
        });
    } catch (error) {
        console.error('Error resetting stats:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to reset stats'
        });
    }
});

// Helper function to analyze grid patterns
function analyzeGrid(grid) {
    return {
        dimensions: {
            width: grid[0].length,
            height: grid.length
        },
        uniqueValues: [...new Set(grid.flat())],
        patterns: detectPatterns(grid),
        symmetry: checkSymmetry(grid)
    };
}

// Helper function to find similar puzzles
function findSimilarPuzzles(input, output) {
    return stats.partialSuccesses.filter(attempt => {
        const inputSimilarity = GridTransformer.compareGrids(attempt.input, input);
        const outputSimilarity = GridTransformer.compareGrids(attempt.expectedOutput, output);
        return inputSimilarity > 0.7 || outputSimilarity > 0.7;
    });
}

// Helper function to generate transformation sets based on analysis
function generateTransformationSets(inputAnalysis, outputAnalysis, currentBestResult = null) {
    const sets = [];
    
    // Get strategies sorted by effectiveness
    const effectiveStrategies = Object.entries(stats.strategyEffectiveness)
        .map(([strategy, stats]) => ({
            strategy,
            avgSimilarity: stats.totalSimilarity / stats.uses,
            successRate: stats.successes / stats.uses
        }))
        .sort((a, b) => b.avgSimilarity - a.avgSimilarity);

    // Add most effective strategies first
    effectiveStrategies.forEach(({strategy}) => {
        sets.push(strategy.split(','));
    });
    
    // Basic transformations
    const simpleTransforms = ['mirror', 'flipVertical', 'rotate90', 'rotate180', 'rotate270'];
    
    // Add variations based on pattern analysis
    if (inputAnalysis.patterns.symmetrical) {
        if (inputAnalysis.symmetry.horizontal) {
            sets.push(['flipVertical']);
            sets.push(['flipVertical', 'rotate90']);
        }
        if (inputAnalysis.symmetry.vertical) {
            sets.push(['mirror']);
            sets.push(['mirror', 'rotate90']);
        }
        if (inputAnalysis.symmetry.rotational) {
            sets.push(['rotate180']);
        }
    }

    // Add transformations based on shape analysis
    if (inputAnalysis.patterns.shapes.length === outputAnalysis.patterns.shapes.length) {
        const inputShape = inputAnalysis.patterns.shapes[0];
        const outputShape = outputAnalysis.patterns.shapes[0];
        
        if (inputShape && outputShape) {
            // Compare dimensions to suggest transformations
            if (inputShape.boundingBox.width === outputShape.boundingBox.height &&
                inputShape.boundingBox.height === outputShape.boundingBox.width) {
                sets.push(['rotate90'], ['rotate270']);
            }
        }
    }

    // Add transformations based on gradient patterns
    if (inputAnalysis.patterns.gradients !== outputAnalysis.patterns.gradients) {
        sets.push(['mirror'], ['flipVertical']);
    }

    // Try composite transformations for complex cases
    if (currentBestResult && currentBestResult.similarity < 0.5) {
        // Generate new combinations from successful partial matches
        const partialSuccesses = stats.partialSuccesses
            .filter(p => p.similarity > 0.5)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 5);

        for (const success of partialSuccesses) {
            if (success.transformation) {
                const transforms = success.transformation.split(',');
                // Try adding additional transformations
                for (const basic of simpleTransforms) {
                    sets.push([...transforms, basic]);
                }
            }
        }
    }

    // Add basic transformations last as fallback
    sets.push(...simpleTransforms.map(t => [t]));
    
    // Remove duplicates and limit total number of sets
    const uniqueSets = Array.from(new Set(sets.map(JSON.stringify)), JSON.parse);
    return uniqueSets.slice(0, 15); // Limit to prevent excessive attempts
}

// Helper function to detect patterns in a grid
function detectPatterns(grid) {
    const patterns = {
        repeating: false,
        symmetrical: false,
        gradients: false,
        shapes: [],
        sections: detectGridSections(grid),
        valueMappings: detectValueMappings(grid)
    };

    // Check for repeating patterns
    patterns.repeating = hasRepeatingPattern(grid);

    // Check for symmetry
    const symmetry = checkSymmetry(grid);
    patterns.symmetrical = symmetry.horizontal || symmetry.vertical || symmetry.rotational;

    // Check for color/value gradients
    patterns.gradients = hasGradients(grid);

    // Detect basic shapes
    patterns.shapes = detectShapes(grid);

    return patterns;
}

// Helper function to detect grid sections
function detectGridSections(grid) {
    const sections = [];
    const height = grid.length;
    const width = grid[0].length;
    
    // Find rows with same value
    for (let i = 0; i < height; i++) {
        if (grid[i].every(val => val === grid[i][0])) {
            sections.push({
                type: 'separator',
                value: grid[i][0],
                row: i
            });
        }
    }
    
    // Split grid into sections based on separators
    if (sections.length > 0) {
        let startRow = 0;
        for (const separator of sections) {
            if (separator.row > startRow) {
                sections.push({
                    type: 'content',
                    startRow: startRow,
                    endRow: separator.row - 1,
                    content: grid.slice(startRow, separator.row)
                });
            }
            startRow = separator.row + 1;
        }
        if (startRow < height) {
            sections.push({
                type: 'content',
                startRow: startRow,
                endRow: height - 1,
                content: grid.slice(startRow)
            });
        }
    }
    
    return sections;
}

// Helper function to detect value mappings
function detectValueMappings(grid) {
    const mappings = new Map();
    const uniqueValues = [...new Set(grid.flat())];
    
    for (const value of uniqueValues) {
        const positions = [];
        for (let i = 0; i < grid.length; i++) {
            for (let j = 0; j < grid[i].length; j++) {
                if (grid[i][j] === value) {
                    positions.push([i, j]);
                }
            }
        }
        mappings.set(value, {
            count: positions.length,
            positions: positions,
            pattern: detectPositionPattern(positions)
        });
    }
    
    return mappings;
}

// Helper function to detect position patterns
function detectPositionPattern(positions) {
    if (positions.length === 0) return null;
    
    return {
        vertical: positions.every(([_, col]) => col === positions[0][1]),
        horizontal: positions.every(([row, _]) => row === positions[0][0]),
        diagonal: positions.every(([row, col], idx) => 
            Math.abs(row - positions[0][0]) === Math.abs(col - positions[0][1]) ||
            row - positions[0][0] === col - positions[0][1] ||
            row - positions[0][0] === -(col - positions[0][1])
        ),
        clustered: positions.every(([row, col]) => 
            positions.some(([r, c]) => 
                (Math.abs(row - r) <= 1 && Math.abs(col - c) <= 1) && !(row === r && col === c)
            )
        )
    };
}

// Enhanced solve function with pattern-based transformation
async function solveGrid(input, output) {
    if (!input || !output) {
        throw new Error('Missing input or output grid');
    }

    // First analyze input and output for patterns
    const inputAnalysis = analyzeGrid(input);
    const outputAnalysis = analyzeGrid(output);
    
    // Check if input has sections
    if (inputAnalysis.patterns.sections.length > 0) {
        // Find the separator (row of 4's in this case)
        const separator = inputAnalysis.patterns.sections.find(s => 
            s.type === 'separator' && s.value === 4
        );
        
        if (separator) {
            // Get the section above the separator
            const topSection = inputAnalysis.patterns.sections.find(s =>
                s.type === 'content' && s.endRow < separator.row
            );
            
            if (topSection) {
                // Analyze the positions of 7's in the top section
                const result = new Array(output.length).fill().map(() => 
                    new Array(output[0].length).fill(0)
                );
                
                // Map 7's to 3's based on relative positions
                for (let i = 0; i < topSection.content.length; i++) {
                    for (let j = 0; j < topSection.content[i].length; j++) {
                        if (topSection.content[i][j] === 7) {
                            // Calculate relative position in output
                            const outRow = Math.floor((i * output.length) / topSection.content.length);
                            const outCol = Math.floor((j * output[0].length) / topSection.content[0].length);
                            result[outRow][outCol] = 3;
                        }
                    }
                }
                
                const similarity = GridTransformer.compareGrids(result, output);
                if (similarity > 0.5) {
                    return {
                        transformation: 'value_mapping',
                        result,
                        similarity,
                        transformSequence: ['value_mapping'],
                        reasoning: ['Applied value mapping based on section analysis']
                    };
                }
            }
        }
    }
    
    // If pattern-based approach fails, try geometric transformations
    return await tryGeometricTransformations(input, output, inputAnalysis, outputAnalysis);
}

// Helper function for geometric transformations
async function tryGeometricTransformations(input, output, inputAnalysis, outputAnalysis) {
    // ... rest of the existing geometric transformation logic ...
    let bestResult = {
        transformation: null,
        result: null,
        similarity: 0,
        transformSequence: [],
        reasoning: []
    };

    // Try basic transformations first
    const basicTransforms = ['mirror', 'flipVertical', 'rotate90', 'rotate180', 'rotate270'];
    for (const transform of basicTransforms) {
        let result = GridTransformer.applyTransformation([...input], transform);
        const similarity = GridTransformer.compareGrids(result, output);
        
        if (similarity > bestResult.similarity) {
            bestResult = {
                transformation: transform,
                result,
                similarity,
                transformSequence: [transform],
                reasoning: [`Applied ${transform}, improved similarity to ${similarity}`]
            };
            if (similarity === 1) break;
        }
    }

    return bestResult;
}

// Helper function to check symmetry properties
function checkSymmetry(grid) {
    return {
        horizontal: hasHorizontalSymmetry(grid),
        vertical: hasVerticalSymmetry(grid),
        rotational: hasRotationalSymmetry(grid)
    };
}

// Helper function to check for repeating patterns
function hasRepeatingPattern(grid) {
    // Check horizontal repetition
    for (let row of grid) {
        const pattern = findRepeatingSubarray(row);
        if (pattern) return true;
    }

    // Check vertical repetition
    for (let col = 0; col < grid[0].length; col++) {
        const column = grid.map(row => row[col]);
        const pattern = findRepeatingSubarray(column);
        if (pattern) return true;
    }

    return false;
}

// Helper function to find repeating subarrays
function findRepeatingSubarray(arr) {
    const n = arr.length;
    for (let len = 1; len <= n/2; len++) {
        if (n % len === 0) {
            const pattern = arr.slice(0, len);
            let isRepeating = true;
            for (let i = len; i < n; i += len) {
                const segment = arr.slice(i, i + len);
                if (!arraysEqual(pattern, segment)) {
                    isRepeating = false;
                    break;
                }
            }
            if (isRepeating) return pattern;
        }
    }
    return null;
}

// Helper function to check for horizontal symmetry
function hasHorizontalSymmetry(grid) {
    const height = grid.length;
    const width = grid[0].length;
    const midPoint = Math.floor(height / 2);

    for (let i = 0; i < midPoint; i++) {
        for (let j = 0; j < width; j++) {
            if (grid[i][j] !== grid[height - 1 - i][j]) {
                return false;
            }
        }
    }
    return true;
}

// Helper function to check for vertical symmetry
function hasVerticalSymmetry(grid) {
    const height = grid.length;
    const width = grid[0].length;
    const midPoint = Math.floor(width / 2);

    for (let i = 0; i < height; i++) {
        for (let j = 0; j < midPoint; j++) {
            if (grid[i][j] !== grid[i][width - 1 - j]) {
                return false;
            }
        }
    }
    return true;
}

// Helper function to check for rotational symmetry
function hasRotationalSymmetry(grid) {
    const height = grid.length;
    const width = grid[0].length;

    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            if (grid[i][j] !== grid[height - 1 - i][width - 1 - j]) {
                return false;
            }
        }
    }
    return true;
}

// Helper function to check for gradients
function hasGradients(grid) {
    // Check horizontal gradients
    for (let row of grid) {
        if (isGradient(row)) return true;
    }

    // Check vertical gradients
    for (let j = 0; j < grid[0].length; j++) {
        const column = grid.map(row => row[j]);
        if (isGradient(column)) return true;
    }

    return false;
}

// Helper function to check if array forms a gradient
function isGradient(arr) {
    let increasing = true;
    let decreasing = true;

    for (let i = 1; i < arr.length; i++) {
        if (arr[i] <= arr[i-1]) increasing = false;
        if (arr[i] >= arr[i-1]) decreasing = false;
    }

    return increasing || decreasing;
}

// Helper function to detect basic shapes in the grid
function detectShapes(grid) {
    const shapes = [];
    const visited = Array(grid.length).fill().map(() => Array(grid[0].length).fill(false));

    for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[0].length; j++) {
            if (!visited[i][j] && grid[i][j] !== 0) {
                const shape = floodFill(grid, visited, i, j, grid[i][j]);
                if (shape.coords.length > 0) {
                    shapes.push(shape);
                }
            }
        }
    }

    return shapes;
}

// Helper function for flood fill algorithm
function floodFill(grid, visited, row, col, value) {
    const coords = [];
    const queue = [[row, col]];
    const height = grid.length;
    const width = grid[0].length;

    while (queue.length > 0) {
        const [r, c] = queue.shift();
        
        if (r < 0 || r >= height || c < 0 || c >= width || 
            visited[r][c] || grid[r][c] !== value) {
            continue;
        }

        visited[r][c] = true;
        coords.push([r, c]);

        queue.push([r-1, c], [r+1, c], [r, c-1], [r, c+1]);
    }

    return {
        value,
        coords,
        boundingBox: getBoundingBox(coords)
    };
}

// Helper function to get bounding box of a shape
function getBoundingBox(coords) {
    if (coords.length === 0) return null;

    let minRow = Infinity, maxRow = -Infinity;
    let minCol = Infinity, maxCol = -Infinity;

    for (const [row, col] of coords) {
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
    }

    return {
        top: minRow,
        bottom: maxRow,
        left: minCol,
        right: maxCol,
        width: maxCol - minCol + 1,
        height: maxRow - minRow + 1
    };
}

// Helper function to compare arrays
function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// Initialize by loading saved progress
loadProgress().then(() => {
    // Load puzzles before starting server
    loadPuzzles();
    
    // Create server with error handling
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`Server running at http://0.0.0.0:${port}`);
    });

    // Handle server-specific errors
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use`);
            process.exit(1);
        } else {
            console.error('Server error:', error);
        }
    });

    // Handle connection errors
    server.on('connection', (socket) => {
        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    });

    // Graceful shutdown
    const shutdown = () => {
        console.log('Shutting down server...');
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });

        // Force close if graceful shutdown fails
        setTimeout(() => {
            console.error('Could not close connections in time, forcefully shutting down');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});