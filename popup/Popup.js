class Popup {
    /**
     * @param {typeof Store} store 
     */
    constructor(store) {
        this.containerNode = /** @type {HTMLElement} */ (document.querySelector(".container"));
        this.optionsButton = /** @type {HTMLElement} */ (document.getElementById("options"));
        this.optionsOKButton = /** @type {HTMLElement} */ (document.querySelector(".options .ok"));
        this.optionsView = /** @type {HTMLCollectionOf<HTMLElement>} */ (document.getElementsByClassName("option"));
        this.csvButton = /** @type {HTMLElement} */ (document.querySelector(".buttons .csv"));
        this.jsonButton = /** @type {HTMLElement} */ (document.querySelector(".buttons .json"));
        this.pdfButton = /** @type {HTMLElement} */ (document.querySelector(".buttons .pdf"));
        this.store = store;
        this.meeting = null;
        this.table = null;
    }

    async init() {
        this.bindOptionsButtons();
        const meeting = await this.getCurrentMeeting();
        if(meeting) {
            this.meeting = meeting;
            this.containerNode.classList.add("has-meeting");
            this.table = new Table(meeting, this);
            this.table.load();
            this.table.render();
            this.bindDowloadButtons();
            this.bindTableButtons();
            this.initListener();
        }
    }

    initListener() {
        // @ts-ignore
        chrome.storage.onChanged.addListener((/** @type {Record<string, { oldValue: *, newValue: * }>} */ changes, /** @type {string} */ namespace) => {
            if(this.table && this.meeting && namespace === "local") {
                const table = this.table;
                const meeting = this.meeting;
                for(const id in changes) {
                    if(id === "list") {
                        const found = changes.list.newValue.find(x => x.dataId === meeting.dataId);
                        if(found) {
                            table.update(found);
                        }
                    } else if(id[0] === "P") {
                        for(const participant of changes[id].newValue) {
                            const row = table.getOrCreateRow(participant);
                            row.update(participant);
                        }
                    } else if(id[0] === "D") {
                        const row = table.get(id.split("-")[2]);
                        if(row) {
                            const newdata = changes[id].newValue.slice(changes[id].oldValue.length);
                            const decoded = newdata.map(x => Store.decodeEvent(x));
                            row.updateData(decoded);
                        }
                    }
                }
                table.render();
            }
        });
    }

    /**
     * @returns {Promise<Awaited<ReturnType<Store.listMeetings>>[0] | undefined>}
     */
    async getCurrentMeeting() {
        // @ts-ignore
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });
        const id = tab?.url?.split("meet.google.com/")[1];
        if(id) {
            const list = await Store.listMeetings();
            return list.find(x => x.id === id && x.lastSeen + 3600000 > Date.now());
        }
    }

    bindOptionsButtons() {
        this.optionsButton.onclick = () => {
            this.containerNode.classList.toggle("has-options");
        };
        
        this.optionsOKButton.onclick = () => {
            this.containerNode.classList.toggle("has-options");
        };
    
        this.store.getOptions().then(options => {
            for(const optionNode of this.optionsView) {
                const key = optionNode.dataset.option;
                const button = /** @type {HTMLElement} */ (optionNode.children[1]);
                button.textContent = options[key] ? "toggle_on" : "toggle_off";
                optionNode.dataset.enabled = Boolean(options[key]).toString();
                button.onclick = () => {
                    const oldstate = optionNode.dataset.enabled;
                    optionNode.dataset.enabled = oldstate === "true" ? "false" : "true";
                    button.textContent = oldstate === "false" ? "toggle_on" : "toggle_off";
                    if((oldstate === "false" && !options[key]) || (oldstate === "true" && options[key])) {
                        options[key] = !options[key];
                        this.store.setOptions(options).catch(console.error);
                    }
                }
            }
        });
    }
    bindDowloadButtons() {
        if(!this.table) {
            return;
        }
        const table = this.table;
        this.csvButton.onclick = () => {
            let csv = "";
            csv += Array.prototype.map.call(table.tableNode.querySelectorAll("tr th span"), x => `${x.getAttribute("title")}`).join(",") + "\n";
            for(const row of table.tableView) {
                csv += Array.prototype.map.call(row.querySelectorAll("td"), x => `${x.innerText}`).join(",") + "\n";
            }
            const link = document.createElement('a');
            link.href = `data:text/plain,${csv}`;
            link.download = `${table.titleNode.textContent} - ${new Date(table.meeting.firstSeen).toISOString()}.csv`;
            link.dispatchEvent(new MouseEvent('click', { 
                bubbles: true, 
                cancelable: true, 
                view: window 
            }));
        }
        
        this.jsonButton.onclick = async () => {
            const meeting = table.meeting;
            const participants = table.data.map(x => x.participant);
            const participantsData = await this.store.getMultipleParticipantsData(table.meeting.dataId, participants.map(x => x.dataId));
            meeting["participants"] = participants;
            for(const participant of participants) {
                participant["data"] = table.get(participant.dataId).parsedState;
                participant["events"] = participantsData[participant.dataId];
            }
            const link = document.createElement('a');
            link.href = `data:text/plain,${JSON.stringify(meeting)}`;
            link.download = `${table.titleNode.textContent} - ${new Date(meeting.firstSeen).toISOString()}.json`;
            link.dispatchEvent(new MouseEvent('click', { 
                bubbles: true, 
                cancelable: true, 
                view: window 
            }));
        }
    
        this.pdfButton.onclick = async () => {
            const styles = /** @type {NodeListOf<HTMLLinkElement>} */ (document.head.querySelectorAll("link[rel=stylesheet]"));
            const promises = /** @type {Promise<string>[]} */ (Array.prototype.map.call(styles, (/** @type {HTMLLinkElement} */ x) => fetch(x.href).then(r => r.text())));
            const head = /** @type {HTMLElement} */ (document.head.cloneNode(true));
            head.querySelector("title")?.remove();
            head.querySelectorAll("link").forEach(x => x.remove());
            head.innerHTML = head.innerHTML +
            (await Promise.all(promises)).map(x => `<style>${x}</style>`).join("") + 
            `<style>
                body { width: ${window.outerWidth}px; margin: 0 auto; }
                .meeting table { width: 90%; margin: 0 auto; }
            </style>` +
            `<title>${table.titleNode.textContent} - ${new Date(table.meeting.firstSeen).toISOString()}</title>`;
    
            const body = /** @type {HTMLElement} */ (document.body.cloneNode(true));
            body.querySelector(".header")?.remove();
            body.querySelector(".buttons")?.remove();
            body.querySelector(".options")?.remove();
            body.querySelectorAll("script")?.forEach(x => x.remove());
    
            const printWindow = /** @type {Window} */ (window.open());
            printWindow.document.write(`<html><head>${head.innerHTML}</head><body>${body.innerHTML}</body></html>`);
            printWindow.document.close();
            printWindow.print();
            printWindow.close();
        }
    }
    
    bindTableButtons() {
        if(!this.table) {
            return;
        }
        const table = this.table;
        for(const icon of table.tableIcons) {
            icon.onclick = () => {
                if(table.meetingNode.dataset.sort === icon.dataset.sort) {
                    const old = table.meetingNode.dataset.reverse;
                    table.meetingNode.dataset.reverse = old === "true" ? "false" : "true";
                    icon.dataset.ui = old === "true" ? "▼" : "▲";
                } else {
                    table.meetingNode.dataset.sort = icon.dataset.sort;
                    table.meetingNode.dataset.reverse = "false";
                    icon.dataset.ui = "▼";
                    for(const i of table.tableIcons) {
                        if(i === icon) {
                            continue;
                        }
                        i.dataset.ui = "";
                    }
                }
                table.render();
            }
        }
    }
}