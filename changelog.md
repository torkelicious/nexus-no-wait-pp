1.1.0 Full Revamp

===  New Features ===
* New Settings UI: Easily configure the script through a user interface (⚙️ button in bottom right corner) +
* Settings Management:
  - Main features are now configurable through UI +
  - Setting persistence (Persistent storage using GM_setValue/getValue)
* Added audio alerts for errors and issues (Mainly failed downloads) +
* Improved Archive Support (Better handling of archived files) 

=== Bug Fixes ===
* Fixed some archived files download issues
* Fixed potential memory leaks +

=== Technical Improvements ===
* Code Changes:
  - Added TypeScript-like documentation with JSDoc comments, and generally Clearer comments (as opposed to the non-existant comments in previous versions) +
  - Better error handling +
  - Improved code organization
  - Better memory management
* Stability & Performance:
  - Proper cleanup routine implemented +
  - Improved error messages with better context, and generally handling them better
  - Improved AJAX handling 
  - Optimized mutation observer +
  - Better event handling +


Basically; A lot has been rewritten, improved, and expanded. And it is all now configurable via a new settings menu.
Considering the fact that I am not exactly talented in JS, there may be some quirks I have not discovered yet... but bugs happen, that's life. (yes, fixes will come if something is discovered)