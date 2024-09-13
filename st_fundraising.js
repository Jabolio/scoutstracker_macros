// ==UserScript==
// @name         ScoutsTracker - Distribution of shared fundraising profits
// @namespace    http://1sttimberlea.ca/
// @description  Adds an input box to a fundrasing event page to allow a user to add a constant amount to all attendees
// @author       Jean-Paul Deveaux
// @match        https://scoutstracker.ca/*/
// @updateURL    https://github.com/Jabolio/scoutstracker_macros/raw/main/st_fundraising.js
// @downloadURL  https://github.com/Jabolio/scoutstracker_macros/raw/main/st_fundraising.js
// @supportURL   https://github.com/Jabolio/scoutstracker_macros/issues
// @version      2024.09.13
// @sandbox      JavaScript
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';
    var shareProfit = Window.shareProfit = {};
    shareProfit.doIt = function() {
        let amt = parseAndValidatePaymentAmount2('#event-fundraising-credit input', 'to deposit'), youth, ledgerID, transactionID, numAdded = 0;
        const now = getNow();
        const outing_id = getCurrentEvent();
        const outing = getOuting(outing_id);

        // for each youth that attended the current event
        for(const member_id of Object.keys(getOutingAttendees2(outing, MEMBERSHIP_TYPE.participant.id))) {
            youth = getMember(member_id);
            ledgerID = youth.cashledgerid;
            transactionID = getRandomLID();
            addLedgerPayment( ledgerID, transactionID, member_id, -1, amt, PAYMENT_TYPE.deposit.id, null, 'Fundraising credit - '+outing.displayname, -1, true, false, now, now, getNonNullLoginID(), true, false );
            numAdded++;
        }

        GM_setValue('creditApplied_'+outing_id, true);
        const CAD = new Intl.NumberFormat('en-CA', {
            style: 'currency',
            currency: 'CAD',
        });

        openLightBox({text: CAD.format(amt)+' was credited to '+numAdded+' youth.', canClose: true});
    }

    // monitor when the event is changed so I can properly populate the custom ledger account box
    const fcm_observer = new MutationObserver(function(mutations) {
        const outing_id = getCurrentEvent();

        // if this is a fundraising event then show the give credits box.
        const outing = getOuting(outing_id);
        let isFundraising = false;
        for(const label of outing.labels) {
            if(label.labelkey == 'fundraising') {
                isFundraising = true;
                $('#event-fundraising-credit').show();

                // check if credits have already been assigned for this event
                if(GM_getValue('creditApplied_'+outing_id, false)){
                    $('#shareProfitBtn').click(function(e) {
                        lightBoxConfirm({text: 'Profits for this event have already been shared with the youth who attended.<br><br>Are you sure you want to do this again?',
                                         callbackTrue: "Window.shareProfit.doIt();",
                                         labelTrue: 'Share Again', labelFalse: 'Cancel', align: 'left'});
                    });
                }
                else {
                     $('#shareProfitBtn').click(function(e) {
                         Window.shareProfit.doIt();
                     });
                }
            }
        }

        if(!isFundraising) {
            $('#event-fundraising-credit').hide();
        }
    });

    fcm_observer.observe(document.querySelector('#view-event'), {
        attributes: true
    });

    GM_addStyle(`
    #event-fundraising-credit a {
        display: grid;
        gap: 5px;
        grid-template-columns: 8fr 1.5fr 0.5fr;
        align-items: center;
    }

    #event-fundraising-credit input {
        height: 20px;
    }

    #event-fundraising-credit .button {
        padding: 3px 10px;
    }
    `);

    $('#event-resolution').before('<ul id="event-fundraising-credit" class="rounded edit"><li><a href="javascript:void(0)"><div>Per-Youth Profit for This Event</div><input type="number" min="1" step="0.01" /><div class="button" id="shareProfitBtn">Share</div></a></li></ul>');
})();