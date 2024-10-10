// ==UserScript==
// @name         ScoutsTracker - Event overpayment sent to Wallet
// @namespace    http://1sttimberlea.ca/
// @description  If a youth pays extra dues, automatically send the balance to the wallet, instead of having to do an extra reimbursement charge
// @author       Jean-Paul Deveaux
// @match        https://scoutstracker.ca/*/
// @updateURL    https://github.com/Jabolio/scoutstracker_macros/raw/main/st_overpayment.js
// @downloadURL  https://github.com/Jabolio/scoutstracker_macros/raw/main/st_overpayment.js
// @supportURL   https://github.com/Jabolio/scoutstracker_macros/issues
// @version      2024.09.13
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    var toWallet = Window.toWallet = {};
    toWallet.doIt = function() {
        let cost, amt = parseAndValidatePaymentAmount2('input[name="payment_inc"]', 'to deposit');
        const outing = g_eventUnderEdit;                                        // reference the global current event object, so changes will persist
        const member_id = $( "#event-payments" ).attr( "data-keyorid" );		// keyOrID is either a memberID, or for isMultiAccountSource events, a subscriber outing key
        const paid_cash = $('#event-payments-source li[data-iledger=-1].selected').length > 0;
        const youth = getMember(member_id);
        const now = getNow();

        // this only kicks in if the member does not have payments allocated for this event yet.
        if(outing.memberpayments[member_id] === undefined) {
            // get cost for this youth.  assume default cost, then check for override.
            cost = outing.cost.participant;
            for(const override of outing.cost.overrides) {
                if(override.memberid = member_id) {
                    cost = override.cost;
                    break;
                }
            }
        }

        // if this is a Payment, and the cost is there, and the amount paid is more than that, and the transaction was cash,
        // then issue a reimbursement to the member for the overpayment
        if($('#payment_type').val() == PAYMENT_TYPE.fee.id && cost > 0 && cost < amt && paid_cash && youth.membershiptype == MEMBERSHIP_TYPE.participant.id) {
            const overpayment = cost - amt;  // this will be negative
            const payment_new = buildMemberPayment( outing.outingid, getRandomLID(), member_id, 1, overpayment, 'Dues Overpayment', '', now, now, false);
            payment_new.iledger = 0;         // this payment must be sent to the cash ledger
            addEventMemberPayment(outing, member_id, payment_new);

            // popup so the user knows that something happened.
            const CAD = new Intl.NumberFormat('en-CA', {
                style: 'currency',
                currency: 'CAD',
            });
            openLightBox({text: CAD.format(-overpayment)+' was added to '+youth.firstname+'\'s Wallet.', canClose: true});
            console.log(overpayment+' deposited into participant wallet - youth: '+youth.firstname+' '+youth.lastname);
        }

        // perform the actual transaction, which will trigger the screen refresh.
        addNewEventMemberPayment();
    }

    // remove the regular "Add Entry" button and add mine, which calls my method (I was not able to override the JS onclick that was already there)
    $('#event-payments-source ul').find('li:last').remove();
    $('#event-payments-source ul').append('<li class="buttons"><div id="update-payment-btn-custom" class="button" onclick="Window.toWallet.doIt()">Add Entry</div></li>');
})();