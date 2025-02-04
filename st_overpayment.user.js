// ==UserScript==
// @name         ScoutsTracker - Event overpayment sent to Wallet
// @namespace    http://1sttimberlea.ca/
// @description  If a youth pays extra dues, automatically send the balance to the wallet, instead of having to do an extra reimbursement charge
// @author       Jean-Paul Deveaux
// @match        https://scoutstracker.ca/*/
// @updateURL    https://github.com/Jabolio/scoutstracker_macros/raw/main/st_overpayment.user.js
// @downloadURL  https://github.com/Jabolio/scoutstracker_macros/raw/main/st_overpayment.user.js
// @supportURL   https://github.com/Jabolio/scoutstracker_macros/issues
// @version      2025.02.03
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    const PAYMENT_NODE = '#event-member-payments', 
          PAYMENT_SRC_NODE = '#event-member-payments-source',
          PAYMENT_TYPE_NODE = '#payment_type';

    const NODES = [PAYMENT_NODE, PAYMENT_SRC_NODE, PAYMENT_TYPE_NODE];

    var toWallet = Window.toWallet = {};
    toWallet.doIt = function() {
        let amt = parseAndValidatePaymentAmount2('input[name=payment_inc]', 'to deposit');
        const outing = g_eventUnderEdit;                                        // reference the global current event object, so changes will persist
        const member_id = $(PAYMENT_NODE).attr( "data-keyorid" );		// keyOrID is either a memberID, or for isMultiAccountSource events, a subscriber outing key
        const paid_cash = $(PAYMENT_SRC_NODE + ' li[data-iledger=-1].selected').length > 0;
        const youth = getMember(member_id);
        const now = getNow();

        let cost = getTotalMemberCost( outing, member_id );

        // how much has been paid so far for this event?
        if(Array.isArray(outing.memberpayments[member_id])) {
            outing.memberpayments[member_id].forEach((payment) => cost -= payment.amount );
        }

        // if this is a Payment, and the cost is there, and the amount paid is more than that, and the transaction was cash,
        // then issue a reimbursement to the member for the overpayment
        if($(PAYMENT_TYPE_NODE).val() == PAYMENT_TYPE.fee.id && cost > 0 && cost < amt && paid_cash && youth.membershiptype == MEMBERSHIP_TYPE.participant.id) {
            const overpayment = cost - amt;  // this will be negative
            let prefix = 'Event Fees ';

            // check the event type - if it's a meeting, then we prefix the overpayment string with "Dues ",
            // otherwise we will prefix with "Event fee"
            for(const label of outing.labels) {
                if(label.labelkey == 'meeting') {
                    prefix = 'Dues ';
                }
            }

            // the time of the overpayment transaction is "a bit in the future" so it will show up after the actual event payment.
            // prototype: buildMemberPayment( strContext, memberID, ledgerID, transactionID, keyOrID, eType, fAmount, strNoteNew, strCategory, iLedger, timestampInserted, timestampUpdated, isDeposit, isNew )
            const payment_new = buildMemberPayment( 'overpayment', member_id, outing.outingid, getRandomLID(), member_id, 1, overpayment, prefix+'Overpayment', '', 0, now+1000, now+1000, false, true);
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

    // make sure all the DOM nodes I need are hanging around...
    try {
        NODES.forEach((node) => {
            if(!$(node).length > 0) {
               throw new Error( 'DOM Node "'+node+'" could not be found.');
            }
        });    
    }
    catch(err) {
        openLightBox( {
            text: 'st_overpayment: '+err,
            canClose: true,
            size: 'big'} );    
    }

    // remove the regular "Add Entry" button and add mine, which calls my method (I was not able to override the JS onclick that was already there)
   $(PAYMENT_SRC_NODE+' ul').find('li:last').remove();
   $(PAYMENT_SRC_NODE+' ul').append('<li class="buttons"><div id="update-payment-btn-custom" class="button" onclick="Window.toWallet.doIt()">Add Entry</div></li>');
})();