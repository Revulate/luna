import * as fuzzball from 'fuzzball';
import logger from './logger.js';

class FuzzySearcher {
  constructor(options = {}) {
    this.abbreviationMapping = {
      // Common game abbreviations
      'ff': 'final fantasy',
      'ff7': 'final fantasy vii',
      'ffvii': 'final fantasy vii',
      'ff 7': 'final fantasy vii',
      'gta': 'grand theft auto',
      'cod': 'call of duty',
      'ac': "assassin's creed",
      'dmc': 'devil may cry',
      'tlou': 'the last of us',
      'botw': 'breath of the wild',
      'totk': 'tears of the kingdom',
      'dbd': 'dead by daylight',
      'btd': 'bloons td',
      'btd6': 'bloons td 6',
      'ds': 'dark souls',
      'ds3': 'dark souls 3',
      'er': 'elden ring',
      'p5': 'persona 5',
      'p5r': 'persona 5 royal',
      'mhw': 'monster hunter world',
      'rdr2': 'red dead redemption 2',
      'reb': 'rebirth',
      'mc': 'minecraft',
      'wow': 'world of warcraft',
      'oot': 'ocarina of time',
      'mm': "majora's mask",
      ...options.abbreviations
    };

    this.gamePatterns = {
      'divinity 2': 'divinity original sin 2',
      'divinity ii': 'divinity original sin 2',
      'dos2': 'divinity original sin 2',
      'ff7r': 'final fantasy vii remake',
      'ff7 r': 'final fantasy vii remake',
      'ff7 remake': 'final fantasy vii remake',
      'ffvii remake': 'final fantasy vii remake',
      'ff7rb': 'final fantasy vii rebirth',
      'ff7 rebirth': 'final fantasy vii rebirth',
      'ffvii rebirth': 'final fantasy vii rebirth',
      ...options.patterns
    };

    // Scoring thresholds
    this.MATCH_THRESHOLD = options.matchThreshold || 35;
    this.CLEAR_MATCH_THRESHOLD = options.clearMatchThreshold || 65;

    // Add roman numeral mappings
    this.romanNumerals = {
      'i': 1,
      'iv': 4,
      'v': 5,
      'ix': 9,
      'x': 10,
      'xl': 40,
      'l': 50,
      'xc': 90,
      'c': 100,
      'cd': 400,
      'd': 500,
      'cm': 900,
      'm': 1000
    };

    this.romanNumeralsList = [
      ['m', 1000],
      ['cm', 900],
      ['d', 500],
      ['cd', 400],
      ['c', 100],
      ['xc', 90],
      ['l', 50],
      ['xl', 40],
      ['x', 10],
      ['ix', 9],
      ['v', 5],
      ['iv', 4],
      ['i', 1]
    ];
  }

  async findMatch(searchTerm, items, options = {}) {
    try {
      if (!searchTerm || !items?.length) {
        logger.debug('Empty search term or items array');
        return { match: null, suggestions: [] };
      }

      logger.debug(`Searching through ${items.length} items for: ${searchTerm}`);
      logger.debug('First few items:', items.slice(0, 3));

      const normalizedSearchTerm = this.normalizeGameName(searchTerm);
      const mappedTerm = this.abbreviationMapping[normalizedSearchTerm] || 
                        this.gamePatterns[normalizedSearchTerm] || 
                        normalizedSearchTerm;

      logger.debug(`Normalized search term: ${normalizedSearchTerm}`);
      logger.debug(`Mapped term: ${mappedTerm}`);

      // Calculate match scores
      const matches = items.map(item => {
        const itemName = this.getItemName(item).toLowerCase();
        const parts = itemName.split(/[:|-]/);
        const mainTitle = parts[parts.length - 1].trim();
        const prefix = parts.length > 1 ? parts[0].trim() : '';

        const scores = this.calculateScores(mappedTerm, itemName, mainTitle, prefix);
        const totalScore = this.calculateTotalScore(scores);

        return { item, score: totalScore, scores };
      });

      // Filter and sort matches
      const validMatches = matches
        .filter(m => m.score > this.MATCH_THRESHOLD)
        .sort((a, b) => b.score - a.score);

      // Log top matches for debugging
      if (validMatches.length > 0) {
        logger.debug('Top matches:', 
          validMatches.slice(0, 3).map(m => ({
            name: this.getItemName(m.item),
            score: m.score,
            scores: m.scores
          }))
        );
      }

      // Return best match if score is above threshold
      if (validMatches.length > 0 && validMatches[0].score > this.CLEAR_MATCH_THRESHOLD) {
        return {
          match: validMatches[0].item,
          score: validMatches[0].score,
          suggestions: []
        };
      }

      // Return suggestions if no clear match
      const suggestions = validMatches
        .slice(0, 3)
        .map(m => this.getItemName(m.item));

      return {
        match: null,
        suggestions,
        topScore: validMatches[0]?.score
      };

    } catch (error) {
      logger.error('Error in fuzzy search:', error);
      throw error;
    }
  }

  calculateScores(searchTerm, itemName, mainTitle, prefix) {
    return {
      // Exact matches
      exactMatch: itemName === searchTerm ? 100 : 0,
      mainTitleExact: mainTitle === searchTerm ? 90 : 0,
      
      // Fuzzy matching
      partialRatio: fuzzball.partial_ratio(searchTerm, mainTitle),
      tokenSortRatio: fuzzball.token_sort_ratio(searchTerm, itemName),
      tokenSetRatio: fuzzball.token_set_ratio(searchTerm, mainTitle),
      
      // Prefix/series matching
      prefixBonus: prefix && (
        searchTerm.includes(prefix) || 
        prefix.includes(searchTerm)
      ) ? 20 : 0,
      
      // Substring matching
      substringBonus: this.calculateSubstringBonus(searchTerm, mainTitle),
      
      // Special matching
      acronymScore: this.calculateAcronymScore(searchTerm, mainTitle),
      seriesScore: this.calculateSeriesScore(searchTerm, itemName)
    };
  }

  calculateTotalScore(scores) {
    return (
      (scores.exactMatch * 1.0) +
      (scores.mainTitleExact * 0.9) +
      (scores.partialRatio * 0.4) +
      (scores.tokenSortRatio * 0.3) +
      (scores.tokenSetRatio * 0.2) +
      scores.prefixBonus +
      scores.substringBonus +
      (scores.acronymScore * 0.5) +
      (scores.seriesScore * 0.4)
    ) / 3;
  }

  calculateSubstringBonus(searchTerm, mainTitle) {
    if (mainTitle === searchTerm) return 30;
    if (mainTitle.includes(` ${searchTerm} `)) return 25;
    if (mainTitle.includes(searchTerm)) return 20;
    return 0;
  }

  calculateAcronymScore(searchTerm, itemName) {
    const acronym = itemName.split(' ')
      .map(word => word[0])
      .join('')
      .toLowerCase();

    if (searchTerm === acronym) return 100;
    if (acronym.includes(searchTerm)) return 50;
    return 0;
  }

  calculateSeriesScore(searchTerm, fullName) {
    const seriesPatterns = {
      'dragon ball': ['dbz', 'dragon ball z', 'kakarot', 'sparking'],
      'final fantasy': ['ff', 'ffvii', 'ff7'],
      'grand theft auto': ['gta'],
      'the legend of zelda': ['zelda', 'botw', 'totk'],
      'persona': ['p5', 'p5r'],
      ...this.gamePatterns
    };

    const lowerFullName = fullName.toLowerCase();
    const searchTermLower = searchTerm.toLowerCase();

    for (const [series, patterns] of Object.entries(seriesPatterns)) {
      if (lowerFullName.includes(series)) {
        if (patterns.some(pattern => 
          searchTermLower.includes(pattern) || 
          pattern.includes(searchTermLower)
        )) {
          return 100;
        }
      }
    }

    return 0;
  }

  getItemName(item) {
    // Handle different item types (string, object with name property, etc.)
    if (typeof item === 'string') return item;
    if (item.name) return item.name;
    if (item.Name) return item.Name;
    return item.toString();
  }

  romanToArabic(roman) {
    if (!roman) return null;

    let result = 0;
    let input = roman.toLowerCase();

    for (let i = 0; i < input.length; i++) {
      const current = this.romanNumerals[input[i]];
      const next = this.romanNumerals[input[i + 1]];

      if (next && current < next) {
        result += next - current;
        i++;
      } else {
        result += current;
      }
    }

    return result;
  }

  arabicToRoman(num) {
    if (!num || typeof num !== 'number') return '';
    
    let result = '';
    for (const [roman, value] of this.romanNumeralsList) {
      while (num >= value) {
        result += roman;
        num -= value;
      }
    }
    return result;
  }

  normalizeGameName(name) {
    if (!name) return '';

    let normalized = name.toLowerCase()
      .replace(/[!?:]/g, '') // Remove special characters
      .replace(/\s+/g, ' ')  // Normalize spaces
      .trim();

    // Handle roman numerals
    normalized = normalized.replace(/\b([ivxlcdm]+)\b/gi, (match) => {
      const arabic = this.romanToArabic(match);
      return arabic ? arabic.toString() : match;
    });

    // Handle number words
    const numberWords = {
      'one': '1',
      'two': '2',
      'three': '3',
      'four': '4',
      'five': '5',
      'six': '6',
      'seven': '7',
      'eight': '8',
      'nine': '9',
      'ten': '10'
    };

    // Replace number words with digits
    for (const [word, digit] of Object.entries(numberWords)) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      normalized = normalized.replace(regex, digit);
    }

    // Handle special cases
    normalized = normalized
      .replace(/(\d+)(st|nd|rd|th)\b/g, '$1') // Remove ordinal suffixes
      .replace(/&/g, 'and')
      .replace(/\+/g, 'plus')
      .replace(/\s*-\s*/g, ' '); // Normalize hyphens

    return normalized;
  }

  // Add helper method to check if a string is a roman numeral
  isRomanNumeral(str) {
    return /^[IVXLCDM]+$/i.test(str);
  }

  // Add helper method to convert numbers in a string
  convertNumbersInString(str, toRoman = false) {
    return str.replace(/\b(\d+|[ivxlcdm]+)\b/gi, (match) => {
      if (/^\d+$/.test(match)) {
        return toRoman ? this.arabicToRoman(parseInt(match)) : match;
      } else if (this.isRomanNumeral(match)) {
        return toRoman ? match : this.romanToArabic(match).toString();
      }
      return match;
    });
  }
}

// Export singleton instance with default options
export const fuzzySearcher = new FuzzySearcher();

// Export class for custom instances
export default FuzzySearcher;
