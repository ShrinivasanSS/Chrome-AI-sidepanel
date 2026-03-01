# Chrome extensions workflow.

## Workflow

- Read `Todo.md` for the next planned features. 
- Use `Progress.md` to update the feature plan, and its current status. 
- If the user query can be implemented with just vanila JS functions, like calling an API or reading a page content, draft a plan on what functions you are going to add.
- If the user query involves chrome API related functionalities, find the most relevant extension or its code to draft a plan on which APIs are needed.
- Always draft a plan first, convert it into a checklist, add it to `Progress.md`, let the human review and add comments, before executing the plan. 
- When creating a draft, first refer to the example extensions, and ask humans which example they need reference to, if unclear. 
- Always ensure that the `ai-sidepanel\README.md` is up to date, along with `Progress.md`, and `Agent-Notes.md`. 

### Project Basic Info
- The main project is in `ai-sidepanel`, uses v3 manifest and needs `<all-urls>` permission to function.
- There is an OpenAI compatible server, outside this project, hosted locally for mock testing.
- Test applications, which can interact with the extensions, to test various functionalities are in `tests` directory.
- There is a vanila html page which is used to interact with the current available options. 
- The entire project was built on 2 examples, in `reference-extension-samples\functional-samples\cookbook.sidepanel-global` and `reference-extension-samples\functional-samples\cookbook.sidepanel-open`.

###  Agent generated Knowledge Base
- Add any findings, that did not work when you first generated code, or the things you discovered after many searches in the `Agent-Notes.md` file. This will only be maintained by an AI such as yourself. 

### Reference Examples

- When a new feature is asked, refer to sample extensions. There are functional and API references on how chrome extensions could be built. The 'reference-extension-samples' directory structure is as follows:

- [api-samples/](api-samples/) - extensions focused on a single API package
- [functional-samples/](functional-samples/) - full featured extensions spanning multiple API packages
- [\_archive/apps/](_archive/apps/) - deprecated Chrome Apps platform (not listed below)
- [\_archive/mv2/](_archive/mv2/) - resources for manifest version 2


### Testing
- Do not run any command to test the package. This will be done by humans, and updated on the `Progress.md` file. 
