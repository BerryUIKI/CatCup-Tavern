// The macro engine lives in `@catcup/shared` because the web client expands the
// same macros when it renders stored messages. This module keeps the server's
// existing import paths stable.
export { type MacroContext, type MacroOptions, substituteMacros } from '@catcup/shared';
