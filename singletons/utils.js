module.exports = (function () {
	"use strict";

	const { parse: urlParser } = require("url");

	const byteUnits = {
		si: {
			multiplier: 1000,
			units: ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
		},
		iec: {
			multiplier: 1024,
			units: ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"]
		}
	};

	const moduleMap = {
		cheerio: () => require("cheerio"),
		chrono: () => require("chrono-node"),
		linkParser: () => {
			const LinkParserFactory = require("track-link-parser");
			return new LinkParserFactory({
				youtube: {
					key: sb.Config.get("API_GOOGLE_YOUTUBE")
				},
				bilibili: {
					appKey: sb.Config.get("BILIBILI_APP_KEY"),
					token: sb.Config.get("BILIBILI_PRIVATE_TOKEN"),
					userAgentDescription: sb.Config.get("BILIBILI_USER_AGENT")
				},
				soundcloud: {
					key: sb.Config.get("SOUNDCLOUD_CLIENT_ID")
				}
	         });
		},
		languageISO: () => require("language-iso-codes"),
		rss: () => new (require("rss-parser"))(),
		random: () => {
			const RandomJS = require("random-js");
			return new RandomJS.Random(RandomJS.MersenneTwister19937.autoSeed());
		},
		parseDuration: () => require("duration-parser"),
		ffprobe: () => require("ffprobe"),
		diceRollEval: () => require("dice-roll-eval"),
		transliterate: () => require("transliteration").transliterate
	};

	// this object has the same keys as moduleMap, but all values are `null`.
	const modules = Object.seal(Object.fromEntries(Object.keys(moduleMap).map(i => [i, null])));
	const moduleProxy = new Proxy(modules, {
		get: function (target, property) {
			if (!modules[property]) {
				modules[property] = moduleMap[property]();
			}

			return modules[property];
		}
	})

	return class Utils extends require("./template.js") {
		get modules () {
			return moduleProxy;
		}

		get languageISO () {
			console.debug("Deprecated access Utils.languageISO");
			return this.modules.languageISO;
		}

		get linkParser () {
			console.debug("Deprecated access Utils.linkParser");
			return this.modules.linkParser;
		}

		/** @inheritDoc */
		static singleton () {
			if (!Utils.module) {
				Utils.module = new Utils();
			}
			return Utils.module;
		}

		/**
		 * Returns onversion numbers between two time units.
		 * @returns {Object}
		 */
		static get timeUnits () {
			return {
				y: {d: 365, h: 8760, m: 525600, s: 31536000, ms: 31536000.0e3},
				d: {h: 24, m: 1440, s: 86400, ms: 86400.0e3},
				h: {m: 60, s: 3600, ms: 3600.0e3},
				m: {s: 60, ms: 60.0e3},
				s: {ms: 1.0e3}
			};
		}

		/**
		 * Class containing various utility methods that don't fit elsewhere.
		 * @name sb.Utils
		 * @type Utils()
		 */
		constructor () {
			super();

			this.htmlEntities = {
				"nbsp": " ",
				"lt": "<",
				"gt": ">",
				"amp": "&",
				"quot": "\"",
				"apos": "'",
				"cent": "¢",
				"pound": "£",
				"yen": "¥",
				"euro": "€",
				"copy": "©",
				"reg": "®",
			};

			const self = this;
			this.tag = {
				trim: (strings, ... values) => {
					const result = [];
					for (let i = 0; i < strings.length; i++) {
						result.push(strings[i].replace(/\s+/g, " "));
						result.push(values[i]);
					}

					return result.join("").trim();
				},
				groupDigits: (strings, ...values) => {
					const result = [];
					for (let i = 0; i < strings.length; i++) {
						result.push(strings[i]);

						if (typeof values[i] === "number") {
							result.push(self.groupDigits(values[i]));
						}
						else {
							result.push(values[i]);
						}
					}

					return result.join("");
				}
			};
		}

		/**
		 * Capitalizes the string's first letter.
		 * @param {string} string
		 * @returns {string}
		 */
		capitalize (string) {
			return string[0].toUpperCase() + string.substring(1).toLowerCase();
		}

		/**
		 * Returns a formatted string, specifying an amount of time delta from current date to provided date.
		 * @param {sb.Date|Date|number} target
		 * @param {boolean} [skipAffixes] if true, the affixes "in X hours" or "X hours ago" will be omitted
		 * @param {boolean} [respectLeapYears] If true, shows a time difference spanning a whole year as `1y` regardless
		 * of the actual length of the year. If disabled, a year is always counted to be 365 * 24 hours. Defaults to false
		 * @param {sb.Date} [deltaTo] If set, calculate time delta between target and deltaTo. If undefined, calculate
		 * delta between target and the current time.
		 * @returns {string}
		 */
		timeDelta (target, skipAffixes = false, respectLeapYears = false, deltaTo = undefined) {
			if (deltaTo === undefined) {
				deltaTo = new sb.Date();
			}

			if (target.valueOf && typeof target.valueOf() === "number") {
				target = new sb.Date(target.valueOf());
			} else {
				throw new ValueError("Invalid parameter type")
			}

			if (sb.Date.equals(deltaTo, target)) {
				return "right now!";
			}

			let string;
			const delta = Math.abs(deltaTo.valueOf() - target.valueOf());
			const [prefix, suffix] = (target > deltaTo) ? ["in ", ""] : ["", " ago"];

			if (delta < Utils.timeUnits.s.ms) {
				string = delta + "ms";
			}
			else if (delta < Utils.timeUnits.m.ms) {
				string = this.round(delta / Utils.timeUnits.s.ms, 2) + "s";
			}
			else if (delta < Utils.timeUnits.h.ms) {
				// Discards the data carried in the last 3 digits, aka milliseconds.
				// E.g. 119999ms should be parsed as "2min, 0sec"; not "1min, 59sec" because of a single millisecond.
				// Rounding to -3 turns 119999 to 120000, which makes the rounding work properly.
				const trimmed = this.round(delta, -3);

				const minutes = Math.trunc(trimmed / Utils.timeUnits.m.ms);
				const seconds = Math.trunc((trimmed / Utils.timeUnits.s.ms ) % Utils.timeUnits.m.s);
				string = minutes + "m, " + seconds + "s";
			}
			else if (delta < Utils.timeUnits.d.ms) {
				// Removing one millisecond from a time delta in (hours, minutes) should not affect the result.
				const trimmed = this.round(delta, -3);

				const hours = Math.trunc(trimmed / Utils.timeUnits.h.ms);
				const minutes = Math.trunc(trimmed / Utils.timeUnits.m.ms) % Utils.timeUnits.h.m;
				string = hours + "h, " + minutes + "m";
			}
			else if (delta < Utils.timeUnits.y.ms) {
				// Removing any amount of milliseconds from a time delta in (days, minutes) should not affect the result.
				const trimmed = this.round(delta, -3);

				const days = Math.trunc(trimmed / Utils.timeUnits.d.ms);
				const hours = Math.trunc(trimmed / Utils.timeUnits.h.ms) % Utils.timeUnits.d.h;
				string = days + "d, " + hours + "h";
			}
			else if (respectLeapYears) { // 365 days or more
				let [earlier, later] = (deltaTo < target) ? [deltaTo, target] : [target, deltaTo];

				// Removing any amount of milliseconds from a time delta in (days, minutes) should not affect the result.
				const trimmed = this.round(delta, -3);

				const laterRounded = new sb.Date(earlier.valueOf() + trimmed);

				// how many whole years lie between the dates?
				let years = laterRounded.getUTCFullYear() - earlier.getUTCFullYear();
				// now only a difference of <1 year remains.
				// Then calculate the remaining time range -> The remaining time delta is then represented by
				// `earlierPlusYears` and `laterRounded`
				const earlierPlusYears = earlier.clone();
				earlierPlusYears.setUTCFullYear(earlierPlusYears.getUTCFullYear() + years);

				// this is in case `earlier` lies later "in the year" then `later`.
				// E.g. earlier=December 1 2019, later=January 1 2021 calculates
				// a year difference of `2`, but the number we want (whole years) is
				// 1.
				// I suppose a `if` would work too but I'm too afraid I would be missing edge cases by doing that.
				// Most of the time the while loop will run 0 or 1 times.
				while (earlierPlusYears.valueOf() > later) {
					earlierPlusYears.setUTCFullYear(earlierPlusYears.getUTCFullYear() - 1);
					years--;
				}

				// Calculate number of remaining days
				const remainingDelta = this.round(laterRounded.valueOf() - earlierPlusYears.valueOf(), -4);
				const days = Math.trunc(remainingDelta / Utils.timeUnits.d.ms);

				string = `${years}y, ${days}d`
			}
			else { // 365 days or more
				// Removing any amount of seconds from a time delta in (years, days) should not affect the result.
				const trimmed = this.round(delta, -4);

				const years = Math.trunc(trimmed / Utils.timeUnits.y.ms);
				const days = Math.trunc(trimmed / Utils.timeUnits.d.ms) % Utils.timeUnits.y.d;
				string = years + "y, " + days + "d";
			}

			return (skipAffixes)
				? string
				: (prefix + string + suffix);
		}

		/**
		 * Transforms a string into a dictionary-like Map to count how many times a word has been used in the message
		 * @param {string} message
		 * @param {"asc"|"desc"} [orderBy] Direction to order the result Map by
		 * @returns {Map<string, number>} The amount of times a word has been used in the message
		 */
		toDictionary (message, orderBy = "asc") {
			const arr = message.replace(/\s+/g, " ").trim().split(" ");
			let dictionary = new Map(arr.map(i => [i, 0]));
			arr.forEach(i => dictionary.set(i, dictionary.get(i) + 1));

			if (orderBy.toLowerCase() === "desc") {
				dictionary = new Map([...dictionary.entries()].sort((a, b) => b[1] - a[1]));
			}
			else if (orderBy.toLowerCase() === "asc") {
				dictionary = new Map([...dictionary.entries()].sort((a, b) => a[1] - b[1]));
			}

			return dictionary;
		}

		/**
		 * Rounds a number to given amount of decimal places.
		 * @param {number} number
		 * @param {number} [places]
		 * @param {Object} options = {}
		 * @param {"ceil"|"floor"|"round"|"trunc"} [options.direction]
		 * @returns {number}
		 */
		round (number, places = 0, options = {}) {
			const direction = options.direction ?? "round";
			if (!["ceil", "floor", "round", "trunc"].includes(direction)) {
				throw new sb.Error({
					message: "Invalid round direction provided",
					args: arguments
				});
			}

			return (Math[direction](number * (10 ** places))) / (10 ** places);
		}

		escapeHTML (string) {
			return string
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#39;");
		}

		/**
		 * @todo Finish documentation
		 * @param {string} string
		 * @returns {string}
		 */
		fixHTML (string) {
			return string.replace(/&#?(?<identifier>[a-z0-9]+);/g, (...params) => {
				const {identifier} = params.pop();
				return this.htmlEntities[identifier] || String.fromCharCode(Number(identifier));
			});
		}

		/**
		 * Removes all HTML-like tags from input string.
		 * @param string
		 * @returns {string}
		 */
		removeHTML (string) {
			return string.replace(/<\s*br.*?>/g, "\n").replace(/<(.*?)>/g, "");
		}

		/**
		 * Wraps the input string into the given amount of characters, discarding the rest.
		 * @param {string} string
		 * @param {number} length
		 * @returns {string}
		 */
		wrapString (string, length) {
			string = string.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
			return (string.length >= length)
				? (string.slice(0, length - 1) + "…")
				: string;
		}

		/**
		 * Returns a random integer between min and max, inclusively.
		 * @param {number} min
		 * @param {number} max
		 * @returns {number}
		 */
		random (min, max) {
			return this.modules.random.integer(min, max);
		}

		/**
		 * Returns a random array element.
		 * @param {Array} arr
		 * @returns {*}
		 */
		randArray (arr) {
			return (arr.length === 0)
				? undefined
				: arr[this.random(0, arr.length - 1)];
		}

		/**
		 * Formats a number specifying the amount of seconds to a string.
		 * @param {number} seconds
		 * @param {boolean} [videoStyle] If false, format will be HH:MM:SS - if true, format will be HH hr, MM min, SS sec
		 * @returns {string}
		 */
		formatTime (seconds = 0, videoStyle = false) {
			const stuff = [];
			if (videoStyle) {
				seconds = Math.trunc(seconds);

				if (seconds >= Utils.timeUnits.h.s) {
					const hr = Math.floor(seconds / Utils.timeUnits.h.s);
					stuff.push(hr);
					seconds -= (hr * Utils.timeUnits.h.s);
				}
				const min = Math.floor(seconds / Utils.timeUnits.m.s);
				stuff.push((stuff.length) ? this.zf(min, 2) : min);
				seconds -= (min * Utils.timeUnits.m.s);
				stuff.push(this.zf(seconds, 2));

				return stuff.join(":");
			}
			else {
				if (seconds >= Utils.timeUnits.d.s) {
					const days = Math.floor(seconds / Utils.timeUnits.d.s);
					stuff.push(days + " days");
					seconds -= (days * Utils.timeUnits.d.s);
				}
				if (seconds >= Utils.timeUnits.h.s) {
					const hr = Math.floor(seconds / Utils.timeUnits.h.s);
					stuff.push(hr + " hr");
					seconds -= (hr * Utils.timeUnits.h.s);
				}
				if (seconds >= Utils.timeUnits.m.s) {
					const min = Math.floor(seconds / Utils.timeUnits.m.s);
					stuff.push(min + " min");
					seconds -= (min * Utils.timeUnits.m.s);
				}
				if (seconds >= 0 || stuff.length === 0) {
					stuff.push(this.round(seconds, 3) + " sec");
				}
				return stuff.join(", ");
			}
		}

		/**
		 * Turns an array of string arguments to a character-separated string.
		 * Usually used for URL requests.
		 * @param {string[]} array
		 * @param {string} [character]
		 * @returns {string}
		 */
		argsToFixedURL(array, character = "+") {
			return array.map(i => encodeURIComponent(i)).join(character);
		}

		/**
		 * Removes all (central European?) accents from a string.
		 * @param {string} string
		 * @returns {string}
		 */
		removeAccents (string) {
			return string.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
		}

		/**
		 * Fetches info about a provided Youtube video.
		 * @param {string} query Search string
		 * @param {string} key Youtube API key
		 * @param {object} options = {} additional options
		 * @param {number} [options.maxResults]
		 * @param {boolean} [options.single]
		 * @returns {Promise<string>}
		 */
		async searchYoutube (query, key, options = {}) {
			const params = { ...options };
			if (params.single) {
				if (typeof params.maxResults !== "undefined") {
					throw new sb.Error({
						message: "Cannot combine params maxResults and single"
					});
				}

				params.maxResults = 1;
			}

			const { items } = await sb.Got({
				url: `https://www.googleapis.com/youtube/v3/search`,
				searchParams: new sb.URLParams()
					.set("q", query)
					.set("key", key)
					.set("type", "video")
					.set("part", "snippet")
					.set("maxResults", params.maxResults ?? "10")
					.set("sort", "relevance")
					.toString()
			}).json();

			const videoList = items.map(i => ({
				ID: i.id.videoId,
				title: i.snippet.title
			}));

			return (params.single)
				? videoList[0] ?? null
				: videoList;
		}

		/**
		 * Fetches a Youtube playlist as an array of video IDs.
		 * Optionally, limits the amount of videos fetched.
		 * @param {Object} options
		 * @params {string} options.key Google/Youtube API key
		 * @params {string} options.playlistID Youtube playlist ID
		 * @params {number} [options.perPage = 50] How many videos should be fetched per page.
		 * @params {number} [options.limit] Limit the number of videos.
		 * @params {string} [options.limitAction]
		 * @returns {Promise<string[]>}
		 */
		async fetchYoutubePlaylist (options = {}) {
			if (!options.key) {
				throw new sb.Error({
					message: "No API key provided"
				});
			}
			else if (!options.playlistID) {
				throw new sb.Error({
					message: "No playlist ID provided"
				});
			}

			const limit = options.limit ?? Infinity;
			const baseParams = new sb.URLParams()
				.set("part", "snippet")
				.set("key", options.key)
				.set("maxResults", options.perPage ?? 50)
				.set("playlistId", options.playlistID);

			let pageToken = null;
			const result = [];
			do {
				const loopParams = baseParams.clone();
				if (pageToken) {
					loopParams.set("pageToken", pageToken);
				}

				const { body: data, statusCode } = await sb.Got({
					url: "https://www.googleapis.com/youtube/v3/playlistItems",
					searchParams: loopParams.toString(),
					throwHttpErrors: false,
					responseType: "json"
				});

				if (statusCode !== 200) {
					return {
						success: false,
						reason: "not-found"
					};
				}

				pageToken = data.nextPageToken;
				result.push(...data.items.map(i => ({
					ID: i.snippet.resourceId.videoId,
					title: i.snippet.title,
					channelTitle: i.snippet.channelTitle,
					published: new sb.Date(i.snippet.publishedAt),
					position: i.snippet.position
				})));

				if (options.limitAction === "trim" && result.length > limit) {
					return result.slice(0, limit);
				}
				else if (data.pageInfo.totalResults > limit) {
					if (options.limitAction === "error") {
						throw new sb.Error({
							message: "Maximum amount of videos exceeded!",
							args: {
								limit,
								amount: data.pageInfo.totalResults
							}
						});
					}
					else if (options.limitAction === "return") {
						return {
							success: false,
							reason: "limit-exceeded",
							limit,
							amount: data.pageInfo.totalResults
						};
					}
					else {
						return {
							success: true,
							reason: "limit-exceeded",
							amount: data.pageInfo.totalResults,
							result,
							limit
						};
					}
				}

			} while (pageToken);

			return {
				success: true,
				result
			};
		}

		/**
		 * Pads a number with specified number of zeroes.
		 * @param {number} number
		 * @param {number} padding
		 * @returns {string}
		 */
		zf (number, padding) {
			return ("0".repeat(padding) + number).slice(-padding);
		}

		/**
		 * Returns string with the english ordinal assigned to it.
		 * @param {number} number
		 * @returns {string}
		 */
		formatEnglishOrdinal (number) {
			number = Number(number);
			switch (number) {
				case 1:
					return "1st";
				case 2:
					return "2nd";
				case 3:
					return "3rd";
				default:
					return "th";
			}
		}

		/**
		 * Returns Google Geo Data for given query
		 * @param {string} key Google Geo API key
		 * @param {string} query
		 * @returns {Promise<Object>}
		 */
		async fetchGeoLocationData (key, query) {
			const { results, status } = await sb.Got({
				url: "https://maps.googleapis.com/maps/api/geocode/json",
				searchParams: new sb.URLParams()
					.set("key", key)
					.set("address", query)
					.toString()
			}).json();

			if (status !== "OK") {
				return {
					success: false,
					cause: status
				};
			}

			const {
				address_components: components,
				formatted_address: formatted,
				place_id: placeID,
				geometry: { location }
			} = results[0];

			const object = {};
			for (const row of components)  {
				let { types, long_name: long } = row;
				if (types.includes("political")) {
					types = types.filter(i => i !== "political");
					types[0] = types[0].replace(/_/g, "").replace("administrativearea", "");
					object[types[0]] = long;
				}
			}

			return {
				success: true,
				components: object,
				placeID,
				location,
				formatted
			};
		}

		/**
		 * Parses strings containing time units into a time number.
		 * @param {string} string A string containing potential data about a duration.
		 * @param {string} unit
		 * @returns {number|{time: number, ranges: Object[]}}
		 */
		parseDuration (string, unit) {
			return this.modules.parseDuration(string, unit);
		}

		/**
		 * Parses a simple video duration in the format HH:MM:SS.vvv to seconds.
		 * Each part is voluntary, [HH:][MM:]SS[.vvv]
		 * @param {string} string
		 * @returns {number|null}
		 */
		parseVideoDuration (string) {
			const parts = string.split(":");
			if (parts.length === 0) {
				return Number(string) ?? null;
			}

			parts.splice(3);

			let mult = 1;
			let number = 0;
			for (let i = parts.length - 1; i >= 0; i--) {
				number += Number(parts[i]) * mult;
				mult *= 60;
			}

			return number ?? null;
		}

		parseChrono (string, referenceDate = null, options = {}) {
			const chronoData = this.modules.chrono.parse(string, referenceDate, options);
			if (chronoData.length === 0) {
				return null;
			}

			const [chrono] = chronoData;
			return {
				date: chrono.start.date(),
				component: chrono.start,
				text: chrono.text
			};
		}

		/**
		 * Checks if the string user is contained within the Discord mentions.
		 * If it is, tries to return a User with the corresponding Discord ID.
		 * Otherwise returns null.
		 * @param {string} stringUser The user name to check
		 * @param {Object} options Discord options object
		 * @returns {Promise<null|User>}
		 */
		async getDiscordUserDataFromMentions (stringUser, options) {
			console.warn("Deprecated getDiscordUserDataFromMentions");

			let result = null;

			if (options && options.mentions) {
				stringUser = stringUser.replace(/^@/, "").toLowerCase();

				if (options.mentions.users.size === 0) {
					return null;
				}

				// Take the first mention
				const mention = options.mentions.users.entries().next().value[1];

				// Now, check if the mention at least contains the username we're trying to find.
				if (mention.username.toLowerCase().includes(stringUser)) {
					const lookup = mention.username.toLowerCase().replace(/\s+/g, "_");
					result = await sb.User.get(lookup, true);
				}
			}

			return result;
		}
		
		convertCase (text, caseFrom, caseTo) {
			if (typeof text !== "string") {
				throw new sb.Error({
					message: "Text must be typeof string",
					args: arguments
				});
			}

			let words = [];
			if (caseFrom === "camel" && caseTo === "snake") {
				words = text.split(/(?=[A-Z])/);
			}
			else if (caseFrom === "snake" && caseTo === "camel") {
				words = text.split("_");
			}
			else if (caseFrom === "kebab" && caseTo === "camel") {
				words = text.split("-");
			}
			else if (caseFrom === "text" && caseTo === "camel") {
				words = text.split(" ");
			}

			let result = "";
			if (caseTo === "snake") {
				result = words.map(i => this.capitalize(i)).join("_");
			}
			else if (caseTo === "snake") {
				result = words.join("-");
			}
			else if (caseTo === "camel") {
				result = words.map((i, ind) => (ind === 0) ? i.toLowerCase() : this.capitalize(i)).join("");
			}

			return result.replace(/id$/i, "ID");
		}

		convertCaseObject (object, caseFrom, caseTo) {
			let result = {};
			for (const [key, value] of Object.entries(object)) {
				if (value && value.constructor === Object) {
					result[this.convertCase(key, caseFrom, caseTo)] = this.convertCaseObject(value, caseFrom, caseTo);
				}
				else if (Array.isArray(value) && value.every(i => i && i.constructor === Object)) {
					result[this.convertCase(key, caseFrom, caseTo)] = value.map(i => this.convertCaseObject(i, caseFrom, caseTo));
				}
				else {
					result[this.convertCase(key, caseFrom, caseTo)] = value;
				}
			}

			return (Array.isArray(object))
				? Object.values(result)
				: result;
		}

		isValidInteger (input, minLimit = 0) {
			if (typeof input !== "number") {
				return false;
			}

			return Boolean(Number.isFinite(input) && Math.trunc(input) === input && input >= minLimit);
		}

		/**
		 * Transliterates non-latin text into latin characters.
		 * @param {...string} args
		 * @returns {string}
		 */
		transliterate (...args) {
			return this.modules.transliterate(...args);
		}

		/**
		 * Splits an array into two, based on the condition function.
		 * @param {Array} array
		 * @param {Function} filter Takes three arguments: (item, index, array)
		 * @returns {[Array, Array]} Two arrays: First one with condition === true, second one with false.
		 */
		splitByCondition (array, filter) {
			if (!Array.isArray(array)) {
				throw new sb.Error({
					message: "array must be an Array"
				});
			}

			const yes = [];
			const no = [];
			for (let i = 0; i < array.length; i++) {
				if (filter(array[i], i, array)) {
					yes.push(array[i]);
				}
				else {
					no.push(array[i]);
				}
			}

			return [yes, no];
		}

		/**
		 * Attempts to fetch a Twitch ID from user cache.
		 * If it doesn't find one, queries the Twitch API endpoint.
		 * @param {string} user
		 * @returns {Promise<null|number>}
		 */
		async getTwitchID (user) {
			let userData = await sb.User.get(user, true);

			if (userData && userData.Twitch_ID) {
				return userData.Twitch_ID;
			}
			else {
				const channelInfo = await sb.Got("Helix", {
					url: "users",
					throwHttpErrors: false,
					searchParams: new sb.URLParams()
						.set("login", user)
						.toString()
				}).json();

				if (!channelInfo.error && channelInfo.data.length !== 0) {
					const {id, display_name: name} = channelInfo.data[0];
					if (!userData) {
						userData = await sb.User.get(name, false);
					}
					if (userData) {
						await userData.saveProperty("Twitch_ID", id);
					}

					return id;
				}
			}

			return null;
		}

		parseURL (stringURL) {
			return urlParser(stringURL);
		}

		/**
		 * Returns the URL's path. Returns null if it is empty.
		 * @param {string} stringURL
		 * @returns {null|string}
		 */
		getPathFromURL (stringURL) {
			const url = urlParser(stringURL);
			const path = (url.path ?? "").replace(/^\//, "");

			return (path.length === 0)
				? null
				: path;
		}

		/**
		 * Utils wrapper for the cheerio module.
		 * @param {string} html
		 * @returns {Cheerio}
		 */
		cheerio (html) {
			return this.modules.cheerio.load(html);
		}

		formatByteSize (number, digits = 3, type = "si") {
			if (type !== "si" && type !== "iem") {
				throw new sb.Error({
					message: "Unsupported byte size format",
					args: { number, type }
				});
			}

			const { multiplier, units } = byteUnits[type];
			number = Math.abs(Math.trunc(Number(number)));

			if (number < multiplier) {
				return number + " B";
			}

			let index = 0;
			while (number >= multiplier && index < units.length) {
				number /= multiplier;
				index++;
			}

			return number.toFixed(digits) + " " + units[index - 1];
		}

		/**
		 * Creates a random string using the characters provided.
		 * If not provided, uses the base ASCII alphabet.
		 * @param {number} length
		 * @param {string|string[]} [characters]
		 */
		randomString (length, characters) {
			if (!characters) {
				characters = "abcdefghiklmnopqrstuvwxyzABCDEFGHIKLMNOPQRSTUVWXYZ".split("");
			}
			else if (typeof characters === "string") {
				characters = characters.split("")
			}
			else if (!Array.isArray(characters) || characters.some(i => typeof i !== "string")) {
				throw new sb.Error({
					message: "Invalid input",
					args: { characters, length }
				});
			}

			const result = [];
			for (let i = 0; i < length; i++) {
				result.push(sb.Utils.randArray(characters));
			}

			return result.join("");
		}

		/**
		 * Recursively deep-freezes an object.
		 * @param {Object} object
		 * @returns {Object}
		 */
		deepFreeze (object) {
			const properties = Object.getOwnPropertyNames(object);
			for (const key of properties) {
				const value = object[key];
				if (value && typeof value === "object" && value.constructor !== RegExp) {
					this.deepFreeze(value);
				}
			}

			return Object.freeze(object);
		}

		/**
		 * Levenshtein distance of two strings.
		 * @param {string} from
		 * @param {string} target
		 * @returns {number}
		 */
		levenshteinDistance (from, target) {
			if (from.length === 0) {
				return target.length;
			}
			if (target.length === 0) {
				return from.length;
			}

			const matrix = [];
			for (let i = 0; i <= target.length; i++) {
				matrix[i] = [i];
			}

			for (let i = 0; i <= from.length; i++) {
				matrix[0][i] = i;
			}

			for (let i = 1; i <= target.length; i++) {
				for (let j = 1; j <= from.length; j++) {
					if (target[i - 1] === from[j - 1]) {
						matrix[i][j] = matrix[i - 1][j - 1];
					}
					else {
						matrix[i][j] = Math.min(
							matrix[i - 1][j - 1] + 1,
							Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
						);
					}
				}
			}

			return matrix[target.length][from.length];
		}

		/**
		 * Jaro-Winkler similarity of two strings.
		 * @param {string} from
		 * @param {string} target
		 * @returns {number}
		 */
		jaroWinklerSimilarity (from, target) {
			// Exit early if either are empty.
			if (from.length === 0 || target.length === 0) {
				return 0;
			}
			else if (from === target) {
				return 1;
			}

			let matches = 0;
			const range = (Math.floor(Math.max(from.length, target.length) / 2)) - 1;
			const fromMatches = Array(from.length);
			const targetMatches = Array(target.length);

			for (let i = 0; i < from.length; i++) {
				const low = (i >= range) ? i - range : 0;
				const high = (i + range <= (target.length - 1))
					? (i + range)
					: (target.length - 1);

				for (let j = low; j <= high; j++) {
					if (fromMatches[i] !== true && targetMatches[j] !== true && from[i] === target[j]) {
						matches++;
						fromMatches[i] = targetMatches[j] = true;
						break;
					}
				}
			}

			// Exit early if no matches were found.
			if (matches === 0) {
				return 0;
			}

			// Count the transpositions.
			let start = 0;
			let transpositions = 0;
			for (let i = 0; i < from.length; i++) {
				if (fromMatches[i] === true) {
					let j = null;
					for (let j = start; j < target.length; j++) {
						if (targetMatches[j] === true) {
							start = j + 1;
							break;
						}
					}

					if (from[i] !== target[j]) {
						++transpositions;
					}
				}
			}

			let l = 0;
			let weight = (matches / from.length + matches / target.length + (matches - (transpositions / 2)) / matches) / 3;
			const p = 0.1;

			if (weight > 0.7) {
				while (from[l] === target[l] && l < 4) {
					++l;
				}

				weight = weight + l * p * (1 - weight);
			}

			return weight;
		}

		/**
		 * @typedef {Object} ClosestStringDescriptor
		 * @property {string} string
		 * @property {string} original
		 * @property {number} index
		 * @property {number} score
		 * @property {boolean} includes
		 */
		/**
		 * Returns the best fit for given string, based on Levenshtein distance.
		 * @param {string} from
		 * @param {string[]} originalTargets
		 * @param {Object} [options]
		 * @param {boolean} [options.ignoreCase] if true, all cases will be ignored
		 * @param {boolean} [options.fullResult] if true, a full array of ClosestStringDescriptor-s will be returned. Mutually exclusive with descriptor
		 * @param {boolean} [options.descriptor] if true, a ClosestStringDescriptor will be returned. Mutually exclusive with fullResult
		 * @returns {null|string|ClosestStringDescriptor|ClosestStringDescriptor[]} null if nothing found, otherwise result based on options
		 */
		selectClosestString (from, originalTargets, options = {}) {
			const targets = originalTargets.slice(0);
			if (options.ignoreCase) {
				from = from.toLowerCase();
				for (let i = 0; i < targets.length; i++) {
					targets[i] = targets[i].toLowerCase();
				}
			}

			const scoreArray = targets.map((i, ind) => this.jaroWinklerSimilarity(from, targets[ind]));
			if (options.fullResult) {
				const result = scoreArray.map((i, ind) => ({
					string: targets[ind],
					original: originalTargets[ind],
					score: i,
					index: ind,
					includes: Boolean(targets[ind].includes(from))
				}));

				return result.sort((a, b) => b.score - a.score);
			}
			else {
				let champion = null;
				let score = -Infinity;
				let index = -1;

				for (let i = 0; i < scoreArray.length; i++) {
					if (targets[i].includes(from) && score < scoreArray[i]) {
						champion = originalTargets[i];
						score = scoreArray[i];
						index = i;
					}
				}

				if (!champion) {
					return null;
				}

				if (options.descriptor) {
					return {
						string: targets[index],
						original: originalTargets[index],
						score,
						includes: Boolean(targets[index].includes(from)),
						index
					};
				}
				else {
					return champion;
				}
			}
		}

		groupDigits (number, separator = " ") {
			const local = new Intl.NumberFormat().format(number);
			return local.replace(/,/g, separator);
		}

		parseRSS (url) {
			return this.modules.rss.parseURL(url);
		}

		async getMediaFileData (link) {
			try {
				const path = sb.Config.get("FFMPEG_PATH");
				const { streams } = await this.modules.ffprobe(link, { path });
				return {
					duration: Number(streams[0].duration),
					bitrate: Number(streams[0].bit_rate)
				};
			}
			catch {
				return null;
			}
		}

		formatSI (number, unit = "", places = 0, addSpace = false) {
			const space = (addSpace) ? " " : "";
			const prefixes = ["", "k", "M", "G", "T", "P", "E", "Z", "Y"];
			const digits = Math.ceil(Math.log10(number + 1));
			const multiplier = Math.trunc((digits - 1) / 3);
			const rounded = this.round(number / (10 ** (multiplier * 3)), places);

			return `${rounded}${space}${prefixes[multiplier]}${unit}`;
		}

		/**
		 * Splits a given string into a given amount of "messages", where each contains up to `limit` characters.
		 * Only splits on entire words
		 * @param {string} message
		 * @param {number} limit
		 * @param {number} messageCount
		 * @returns {[]}
		 */
		partitionString (message, limit, messageCount) {
			if (!this.isValidInteger(limit)) {
				throw new sb.Error({
					message: "Limit must be a positive integer"
				});
			}

			const words = [];
			const regex = new RegExp(".{1," + limit + "}", "g");
			for (const rawWord of message.split(" ")) {
				if (rawWord.length > limit) {
					words.push(...rawWord.match(regex));
				}
				else {
					words.push(rawWord);
				}
			}

			const result = [];
			let buffer = [];
			let counter = 0;
			let messages = 1;
			let loopBroken = false;

			for (const word of words) {
				buffer.push(word);
				counter += word.length + 1;

				if (counter >= limit) {
					counter = 0;

					buffer.pop();
					result.push(buffer.join(" "));
					buffer = [word];
					messages++;
				}

				if (messages > messageCount) {
					loopBroken = true;
					break;
				}
			}

			if (!loopBroken) {
				result.push(buffer.join(" "));
			}

			return result;
		}

		/**
		 * Evaluates an expression in standard dice notation form		 *
		 * @param {string} input
		 * @param {number} limit max number of rolls in a single evaluation
		 * @returns {number}
		 * @throws {Error}
		 */
		evalDiceRoll(input, limit) {
			return this.modules.diceRollEval(input, {
				limit,
				strict: false,
				rng: (min, max) => sb.Utils.random(min, max)
			});
		}

		async uploadToImgur (fileData, link = "random") {
			const formData = new sb.Got.FormData();
			formData.append("image", fileData, link); // !!! FILE NAME MUST BE SET, OR THE API NEVER RESPONDS !!!

			const { statusCode, body } = await sb.Got({
				url: "https://api.imgur.com/3/image",
				responseType: "json",
				method: "POST",
				throwHttpErrors: false,
				headers: {
					...formData.getHeaders(),
					Authorization: "Client-ID c898c0bb848ca39"
				},
				body: formData.getBuffer(),
				retry: 0,
				timeout: 10000
			});

			return {
				statusCode,
				link: body.data?.link ?? null
			};
		}

		async uploadToNuuls (fileData) {
			const form = new sb.Got.FormData();
			form.append("attachment", fileData, "file.jpg");

			const response = await sb.Got({
				method: "POST",
				throwHttpErrors: false,
				url: "https://i.nuuls.com/upload",
				headers: {
					...form.getHeaders()
				},
				body: form.getBuffer(),
				retry: 0,
				timeout: 10000
			});

			return {
				statusCode: response.statusCode,
				link: response.body ?? null
			};
		}

		async checkPictureNSFW (link) {
			const { statusCode, body: data } = await sb.Got({
				method: "POST",
				responseType: "json",
				throwHttpErrors: false,
				url: "https://api.deepai.org/api/nsfw-detector",
				headers: {
					"Api-Key": sb.Config.get("API_DEEP_AI")
				},
				form: {
					image: link
				}
			});

			return {
				statusCode,
				data: {
					id: data.id ?? null,
					score: data.output?.nsfw_score ?? null,
					detections: data.output?.detections ?? null
				}
			};
		}

		get modulePath () { return "utils"; }

		/** @inheritDoc */
		destroy () {
			this.duration = null;
			this.mersenneRandom = null;
		}
	};
})();