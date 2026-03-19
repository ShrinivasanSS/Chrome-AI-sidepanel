# New Workitems 

Mar 16 2026

-- (External project integration)
* The extension should support 'Skills' from a repository or from some build zip (let's say the zip is at http://localhost/skills/latest.zip) and use them while performing agentic actions.
* The skills should be periodically updated. 
* The extension should have 2 modes now. 1 - Developer and 2 - User. This should be configurable in Settings page. 
* The existing extension contains 3 tabs - Basic / Advanced / API. Now these 3 options should only be available when Extension is in Developer mode. In the User Mode only show basic chat/query functionality with settings/history options, no additional tabs. 

Skills support
- Skills are an open standard. Use the `Skills-Reference.md` document for specifications and requirements of implementation. 

# Completed workitems - March 1 2026

## Human Review comments 

Tested functionalities
- [x] Test Pages for Vanila and JSP 
- [x] Accepts Photos, Zip and JSON
- [x] Responses rendered in the test pages to satisfaction

Bugs found
- [ ] Extension view not refreshed automatically. It loads the responses only when closing and re-opening the side panel. 

The following changes are deemed complete. 

## API Format changes
- The existing API to invoke the sidepanel extension (from a custom page) has to be expanded to support more formats.
- As of now, it only supports application/json. But it should be expanded to support zip and images/base64. 
- The extension should accept the zip, unzip it and based on the files in that, it should invoke the backend AI (OpenAI Compatible server) with appropriate data. Like Text inside 'messages/content/text' and images in 'image_url'.
- Unsupported formats can be ignored rather than throw error as of now. 

## Extension design changes
- The extension stores the input data and output data in cache, so that the history of conversations can be viewed locally. 
- The storage has to be in the extension's own directory. The amount of usage has to be tracked and stored separately.
- An option should be shown in extension settings about how much storage is being used and a 'Clean Storage' button that clears out the used space.
- An option to add more than 1 model and set the default model should be present.  
- (Optional) Optimize or Come up with a new API format so that the extension accepts 'n' number of tasks, and makes 'n' number of AI calls, and updates the results in 'n' number of collapsible boxes. 
- (Optional) Add a concurrency option to the extension where it can send more than 1 requests to the backend LLM Server. Default is 1. 

## Vanila HTML Test page updates
- The existing `tests/vanila-html` page has to be updated based on the changes of input/output format described above. 

## JSP Testing Pages in containers.
- Create a sample JSP application with 2 or 3 pages, that will invoke the sidepanel. 
- Must have pages: 1. Analyze Photos and 2. Analyze Zip. (Optional) 3. Analyze JSON.
- These pages must send the sample data in the `tests` directory. The zip actually contains the compressed folders of `json` and `screenshots`. 
- The results must be rendered in both the extension and the JSP pages.