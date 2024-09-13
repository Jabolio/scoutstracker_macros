// ==UserScript==
// @name         ScoutsTracker - Auto-pay meeting dues with Wallet funds
// @namespace    http://1sttimberlea.ca/
// @description  After an event has completed, automatically apply attendee credits toward event dues/fees if there are enough available.
// @author       Jean-Paul Deveaux
// @match        https://scoutstracker.ca/*/
// @updateURL    https://github.com/Jabolio/scoutstracker_macros/raw/main/st_autopay_dues.js
// @downloadURL  https://github.com/Jabolio/scoutstracker_macros/raw/main/st_autopay_dues.js
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
    var applyCredits = Window.applyCredits = {};
    applyCredits.doIt = function() {
        const now = getNow();
        const outing_id = getCurrentEvent();
        const outing = getOuting(outing_id);
        let cost, youth, ledgerID, youthPaid = '';

        const CAD = new Intl.NumberFormat('en-CA', {
            style: 'currency',
            currency: 'CAD',
        });

        // for each youth that attended the current event
        for(const member_id of Object.keys(getOutingAttendees2(outing, MEMBERSHIP_TYPE.participant.id))) {
            // if the current youth does not have a payment associated with this event, and they have enough credit in their wallet, then apply whatever they owe.
            if(outing.memberpayments[member_id] === undefined) {
                youth = getMember(member_id);

                // get cost for this youth.  assume default cost, then check for override.
                cost = outing.cost.participant;
                for(const override of outing.cost.overrides) {
                    if(override.memberid = member_id) {
                        cost = override.cost;
                        break;
                    }
                }

                // if there is a cost for this youth, and the youth has enough in their wallet, then apply it.
                ledgerID = youth.cashledgerid;
                if(cost > 0 && getLedgerBalance(ledgerID) > cost) {
                    const payment_new = buildMemberPayment( outing_id, getRandomLID(), member_id, PAYMENT_TYPE.fee.id, cost, 'Dues paid using Wallet credits', "", now, now, false );
                    payment_new.iledger = 0;
                    addEventMemberPayment( outing, member_id, payment_new );
                    youthPaid += '<div class="tYouthPaid"><div>'+youth.firstname+' '+youth.lastname+'</div><div>'+CAD.format(cost)+'</div></div>';
                }
            }
        }

        // if more than one youth paid, mark that the event has changed, save the signups, and view the event again (because saving the signups brings up the calendar)
        if(youthPaid != '') {
            setEventAsChanged();
            g_eventUnderEdit = outing;
            doSaveSignups();
            doViewEvent(outing_id);
            openLightBox({text: 'The following credits were applied:<div style="margin-top:5px">'+youthPaid+'</div>', canClose: true});
        }
        else {
            openLightBox({text: 'No credits applied at this time.', canClose: true});
        }
    }

    // monitor when the event is changed so I can properly populate the custom ledger account box
    const mdcm_observer = new MutationObserver(function() {
        const outing_id = getCurrentEvent();
        const now = getNow();

        // if this is event has a fee associated with it and is in the past, show the button.
        const outing = getOuting(outing_id);
        if(outing.date <= now && outing.cost.participant > 0) {
            $('#event-apply-credits').show();
        }
        else {
            $('#event-apply-credits').hide();
        }
    });

    mdcm_observer.observe(document.querySelector('#view-event'), {
        attributes: true
    });

    GM_addStyle(`
    .tYouthPaid {
        display: grid;
        justify-items: left;
        grid-template-columns: 6fr 1fr;
    }`);

    $('#event-resolution').before('<ul id="event-apply-credits" class="rounded edit"><li><a href="javascript:void(0)"><div class="button" onclick="Window.applyCredits.doIt();">Automatically Apply Available Credits to All Attendees</div></a></li></ul>');
})();